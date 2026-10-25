-- =============================================================================
-- Ponto Digital CRM — Fase 2: WhatsApp oficial (coexistência), equipe e IA
--
-- Somente ACRÉSCIMOS (colunas com padrão, tabelas e funções novas): pode ser
-- aplicada com o CRM no ar sem afetar a versão publicada.
--
--   * Mensagens: mídia (imagem, áudio, vídeo, documento), erro de entrega e
--     marcação de resposta sugerida pela IA.
--   * Distribuição de atendimentos por rodízio entre membros da equipe.
--   * Recebimento dos webhooks pelo servidor: função única, idempotente e
--     transacional (public.wa_ingest_event), executável SOMENTE pelo servidor.
--   * Conta do WhatsApp (coexistência): IDs e token criptografado, invisíveis
--     para usuários e visitantes.
--   * Base de conhecimento e histórico de sugestões da IA.
--   * Anonimização LGPD no banco (somente administradores).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Mensagens: mídia, erro de entrega, IA
-- ---------------------------------------------------------------------------
-- media: {"type":"image|audio|video|document|sticker","id":"<media id da Meta>",
--         "mime":"image/jpeg","filename":"proposta.pdf","caption":"..."}
alter table public.messages
  add column media jsonb check (media is null or (jsonb_typeof(media) = 'object' and length(media::text) <= 2000)),
  add column error text check (length(error) <= 300),
  add column ai_assisted boolean not null default false;

grant insert (media, ai_assisted) on public.messages to authenticated;

-- Campanhas (simulação) também gravam a mensagem enviada em nome de quem executou.
drop policy msg_insert on public.messages;
create policy msg_insert on public.messages for insert to authenticated with check (
  org_id = app.current_org()
  and direction = 'out' and author_id = auth.uid() and status in ('simulada', 'enviada')
  and (origin = 'crm' or (origin = 'campanha' and app.has_role('admin', 'gestor')))
  and exists (select 1 from public.conversations c where c.id = conversation_id)
);

-- ---------------------------------------------------------------------------
-- Distribuição de atendimentos
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column wa_distribution text not null default 'manual' check (wa_distribution in ('manual', 'rodizio'));
grant update (wa_distribution) on public.organizations to authenticated; -- política org_update: só admin

alter table public.profiles
  add column in_rotation boolean not null default false,
  add column last_assigned_at timestamptz;
grant update (in_rotation) on public.profiles to authenticated; -- política profiles_update: só admin

-- Próximo membro do rodízio (o que recebeu atendimento há mais tempo).
create function app.next_in_rotation(p_org uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select p.id into v_user from public.profiles p
   where p.org_id = p_org and p.active and p.in_rotation
   order by p.last_assigned_at nulls first, p.created_at
   limit 1
   for update skip locked;
  if v_user is not null then
    update public.profiles set last_assigned_at = now() where id = v_user;
  end if;
  return v_user;
end $$;

-- ---------------------------------------------------------------------------
-- Contatos do app WhatsApp Business (coexistência: smb_app_state_sync)
-- Não viram clientes automaticamente: servem para dar nome a quem escrever.
-- ---------------------------------------------------------------------------
create table public.wa_contacts (
  org_id uuid not null references public.organizations (id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  phone_key text generated always as (
    case when phone ~ '^55[0-9]{2}9[0-9]{8}$' then substr(phone, 1, 4) || substr(phone, 6) else phone end
  ) stored,
  name text not null default '' check (length(name) <= 120),
  updated_at timestamptz not null default now(),
  primary key (org_id, phone_key)
);
alter table public.wa_contacts enable row level security;
grant select on public.wa_contacts to authenticated;
grant select, insert, update, delete on public.wa_contacts to service_role;
create policy wa_contacts_select on public.wa_contacts for select to authenticated using (org_id = app.current_org());

-- ---------------------------------------------------------------------------
-- Conta do WhatsApp conectada (Embedded Signup / coexistência)
-- Nenhum privilégio para anon/authenticated: só o servidor lê e grava.
-- O token fica criptografado (AES-256-GCM) com uma chave que existe apenas
-- nas variáveis de ambiente do servidor (WHATSAPP_TOKEN_KEY).
-- ---------------------------------------------------------------------------
create table public.whatsapp_accounts (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  phone_number_id text not null unique,
  waba_id text not null,
  display_phone text not null default '',
  verified_name text not null default '',
  coexistence boolean not null default true,
  token_ciphertext text,
  onboarded_by uuid,
  onboarded_at timestamptz not null default now(),
  contacts_sync_requested_at timestamptz,
  history_sync_requested_at timestamptz,
  history_status text not null default 'pendente' check (history_status in ('pendente', 'recebendo', 'concluido', 'recusado', 'erro')),
  last_error text check (length(last_error) <= 500),
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_accounts enable row level security;
revoke all on public.whatsapp_accounts from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_accounts to service_role;

alter table public.webhook_events add column phone_number_id text;

-- ---------------------------------------------------------------------------
-- Recebimento de eventos do WhatsApp (chamado só pelo servidor, após validar
-- a assinatura da Meta). Idempotente: o mesmo evento reenviado não duplica nada.
--
-- p_event (montado pelo servidor a partir do webhook oficial):
--   {"kind":"inbound|echo|history", "waMessageId", "phone", "name", "text",
--    "timestamp", "media", "direction" (history), "optOut" (inbound)}
--   {"kind":"status", "waMessageId", "status":"sent|delivered|read|failed", "error"}
--   {"kind":"contact_sync", "phone", "name", "action":"add|remove"}
--   {"kind":"template_status", "name", "language", "status", "metaTemplateId"}
-- ---------------------------------------------------------------------------
create function public.wa_ingest_event(p_org uuid, p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k text := p_event->>'kind';
  v_wamid text := nullif(p_event->>'waMessageId', '');
  v_phone text := regexp_replace(coalesce(p_event->>'phone', ''), '\D', '', 'g');
  v_key text;
  v_ts timestamptz := case when coalesce((p_event->>'timestamp')::bigint, 0) > 0
                           then to_timestamp((p_event->>'timestamp')::bigint) else now() end;
  v_client uuid;
  v_conv uuid;
  v_assignee uuid;
  v_new_client boolean := false;
  v_msg uuid;
  v_status app.message_status;
  v_rank int;
  v_name text;
begin
  if not exists (select 1 from public.organizations o where o.id = p_org) then
    raise exception 'Organização inexistente';
  end if;

  -- Status de entrega: só avança (enviada → entregue → lida); falha é registrada.
  if k = 'status' then
    v_status := case p_event->>'status' when 'sent' then 'enviada' when 'delivered' then 'entregue'
                  when 'read' then 'lida' when 'failed' then 'falhou' end;
    if v_status is null or v_wamid is null then return jsonb_build_object('result', 'ignored'); end if;
    v_rank := case v_status when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 else 9 end;
    update public.messages m set
      status = v_status,
      error = case when v_status = 'falhou' then left(coalesce(p_event->>'error', 'Falha na entrega'), 300) else m.error end
     where m.org_id = p_org and m.wa_message_id = v_wamid and m.direction = 'out'
       and v_rank > case m.status when 'simulada' then 0 when 'enviada' then 1 when 'entregue' then 2
                                  when 'lida' then 3 else 99 end;
    update public.campaign_recipients r set status = v_status::text::app.recipient_status
     where r.org_id = p_org and r.wa_message_id = v_wamid
       and v_rank > case r.status when 'simulada' then 0 when 'enviada' then 1 when 'entregue' then 2
                                  when 'lida' then 3 else 99 end;
    return jsonb_build_object('result', 'status');
  end if;

  -- Contatos do app WhatsApp Business
  if k = 'contact_sync' then
    if v_phone !~ '^[0-9]{8,15}$' then return jsonb_build_object('result', 'ignored'); end if;
    if p_event->>'action' = 'remove' then
      delete from public.wa_contacts c where c.org_id = p_org and c.phone = v_phone;
    else
      insert into public.wa_contacts (org_id, phone, name)
      values (p_org, v_phone, left(coalesce(p_event->>'name', ''), 120))
      on conflict (org_id, phone_key) do update set name = excluded.name, updated_at = now();
      -- Dá nome a clientes criados automaticamente ("Contato 1234")
      update public.clients c set name = left(p_event->>'name', 120)
       where c.org_id = p_org and coalesce(p_event->>'name', '') <> '' and c.name ~ '^Contato [0-9]{4}$'
         and c.phone_key = (case when v_phone ~ '^55[0-9]{2}9[0-9]{8}$' then substr(v_phone, 1, 4) || substr(v_phone, 6) else v_phone end);
    end if;
    return jsonb_build_object('result', 'contact');
  end if;

  -- Resultado da análise de modelos pela Meta
  if k = 'template_status' then
    update public.message_templates t set
      status = (p_event->>'status')::app.template_status,
      meta_template_id = coalesce(nullif(p_event->>'metaTemplateId', ''), t.meta_template_id)
     where t.org_id = p_org and t.name = p_event->>'name' and t.language = coalesce(p_event->>'language', t.language)
       and p_event->>'status' in ('APPROVED', 'PENDING', 'REJECTED');
    return jsonb_build_object('result', 'template');
  end if;

  if k not in ('inbound', 'echo', 'history') or v_wamid is null or v_phone !~ '^[0-9]{8,15}$' then
    return jsonb_build_object('result', 'ignored');
  end if;
  if exists (select 1 from public.messages m where m.org_id = p_org and m.wa_message_id = v_wamid) then
    return jsonb_build_object('result', 'duplicate');
  end if;

  v_key := case when v_phone ~ '^55[0-9]{2}9[0-9]{8}$' then substr(v_phone, 1, 4) || substr(v_phone, 6) else v_phone end;

  -- Cliente (criado automaticamente, sem consentimento de marketing presumido)
  select c.id into v_client from public.clients c where c.org_id = p_org and c.phone_key = v_key;
  if v_client is null then
    select nullif(w.name, '') into v_name from public.wa_contacts w where w.org_id = p_org and w.phone_key = v_key;
    insert into public.clients (org_id, name, phone, tags, notes)
    values (p_org,
            left(coalesce(v_name, nullif(trim(p_event->>'name'), ''), 'Contato ' || right(v_phone, 4)), 120),
            v_phone, array['WhatsApp'],
            case k when 'history' then 'Criado a partir do histórico sincronizado do app WhatsApp Business.'
                   else 'Criado automaticamente a partir de mensagem do WhatsApp.' end)
    on conflict (org_id, phone_key) do nothing
    returning id into v_client;
    if v_client is null then
      select c.id into v_client from public.clients c where c.org_id = p_org and c.phone_key = v_key;
    else
      v_new_client := true;
      insert into public.deals (org_id, client_id, title)
      values (p_org, v_client, case k when 'inbound' then 'Novo contato via WhatsApp' else 'Contato do WhatsApp' end);
    end if;
  end if;

  -- Conversa (com distribuição por rodízio para mensagens novas de clientes)
  select c.id, c.assignee_id into v_conv, v_assignee from public.conversations c
   where c.org_id = p_org and c.client_id = v_client;
  if v_conv is null then
    if k = 'inbound' and (select o.wa_distribution from public.organizations o where o.id = p_org) = 'rodizio' then
      v_assignee := app.next_in_rotation(p_org);
    end if;
    insert into public.conversations (org_id, client_id, assignee_id, status, last_message_at)
    values (p_org, v_client, v_assignee, case when k = 'inbound' then 'aberta' else 'resolvida' end::app.conversation_status, v_ts)
    on conflict (org_id, client_id) do nothing
    returning id into v_conv;
    if v_conv is null then
      select c.id into v_conv from public.conversations c where c.org_id = p_org and c.client_id = v_client;
    end if;
  elsif k = 'inbound' and v_assignee is null
        and (select o.wa_distribution from public.organizations o where o.id = p_org) = 'rodizio' then
    update public.conversations c set assignee_id = app.next_in_rotation(p_org) where c.id = v_conv;
  end if;

  insert into public.messages (org_id, conversation_id, direction, origin, body, status, wa_message_id, media, created_at)
  values (
    p_org, v_conv,
    case k when 'inbound' then 'in' when 'echo' then 'out' else coalesce(nullif(p_event->>'direction', ''), 'in') end,
    case k when 'inbound' then 'cliente' when 'echo' then 'app_business' else 'historico' end::app.message_origin,
    left(coalesce(p_event->>'text', ''), 4096),
    case when k = 'inbound' or (k = 'history' and p_event->>'direction' <> 'out') then 'recebida'
         when k = 'echo' then 'enviada' else 'entregue' end::app.message_status,
    v_wamid,
    case when jsonb_typeof(p_event->'media') = 'object' then p_event->'media' end,
    v_ts
  )
  on conflict (org_id, wa_message_id) do nothing
  returning id into v_msg;
  if v_msg is null then return jsonb_build_object('result', 'duplicate'); end if;

  if k = 'inbound' then
    -- Resposta a campanha executada nos últimos 7 dias
    update public.campaign_recipients r set status = 'respondeu'
      from public.campaigns cp
     where r.campaign_id = cp.id and r.org_id = p_org and r.client_id = v_client
       and cp.status = 'concluida' and cp.executed_at >= now() - interval '7 days'
       and r.status not in ('descadastrou', 'respondeu');
    -- Descadastro por palavra-chave (SAIR, PARAR, STOP…): detectado pelo servidor
    if coalesce((p_event->>'optOut')::boolean, false) then
      insert into public.consent_events (org_id, client_id, status, source, note)
      values (p_org, v_client, 'opt_out', 'palavra_chave', left('Cliente enviou "' || coalesce(p_event->>'text', '') || '"', 500));
      update public.campaign_recipients r set status = 'descadastrou' where r.org_id = p_org and r.client_id = v_client;
      insert into public.messages (org_id, conversation_id, direction, origin, body, status, created_at)
      values (p_org, v_conv, 'out', 'sistema', 'Contato descadastrado das campanhas (pedido de opt-out).', 'simulada', v_ts + interval '1 millisecond');
    end if;
  end if;

  return jsonb_build_object('result', 'inserted', 'newClient', v_new_client, 'conversationId', v_conv);
end $$;
revoke execute on function public.wa_ingest_event(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.wa_ingest_event(uuid, jsonb) to service_role;

-- Lote de eventos numa única chamada (a sincronização de histórico chega em blocos grandes).
create function public.wa_ingest_batch(p_org uuid, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e jsonb; r jsonb; v_out jsonb := '{}'::jsonb; v_key text;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 1000 then
    raise exception 'Lote inválido';
  end if;
  for e in select * from jsonb_array_elements(p_events) loop
    r := public.wa_ingest_event(p_org, e);
    v_key := r->>'result';
    v_out := jsonb_set(v_out, array[v_key], to_jsonb(coalesce((v_out->>v_key)::int, 0) + 1));
    if (r->>'newClient')::boolean then
      v_out := jsonb_set(v_out, '{newClients}', to_jsonb(coalesce((v_out->>'newClients')::int, 0) + 1));
    end if;
  end loop;
  return v_out;
end $$;
revoke execute on function public.wa_ingest_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.wa_ingest_batch(uuid, jsonb) to service_role;
revoke execute on function app.next_in_rotation(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Inteligência artificial
-- ---------------------------------------------------------------------------
create table public.ai_knowledge (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  about text not null default '' check (length(about) <= 4000),
  services text not null default '' check (length(services) <= 8000),
  prices text not null default '' check (length(prices) <= 8000),
  portfolio text not null default '' check (length(portfolio) <= 6000),
  tone text not null default '' check (length(tone) <= 4000),
  faq text not null default '' check (length(faq) <= 10000),
  rules text not null default '' check (length(rules) <= 4000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.ai_knowledge enable row level security;
grant select on public.ai_knowledge to authenticated;
grant insert (org_id, enabled, about, services, prices, portfolio, tone, faq, rules, updated_by) on public.ai_knowledge to authenticated;
grant update (enabled, about, services, prices, portfolio, tone, faq, rules, updated_by, updated_at) on public.ai_knowledge to authenticated;
grant select, insert, update, delete on public.ai_knowledge to service_role;
create policy ai_kb_select on public.ai_knowledge for select to authenticated using (org_id = app.current_org());
create policy ai_kb_insert on public.ai_knowledge for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor') and updated_by = auth.uid());
create policy ai_kb_update on public.ai_knowledge for update to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor'))
  with check (org_id = app.current_org() and updated_by = auth.uid());

create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  created_by uuid not null,
  model text not null check (length(model) <= 60),
  suggestion text not null check (length(suggestion) <= 4096),
  needs_human boolean not null default false,
  reason text not null default '' check (length(reason) <= 500),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  status text not null default 'sugerida' check (status in ('sugerida', 'usada', 'descartada')),
  created_at timestamptz not null default now(),
  foreign key (org_id, conversation_id) references public.conversations (org_id, id) on delete cascade
);
create index on public.ai_suggestions (org_id, created_at desc);
alter table public.ai_suggestions enable row level security;
grant select on public.ai_suggestions to authenticated;
grant insert (org_id, conversation_id, created_by, model, suggestion, needs_human, reason, input_tokens, output_tokens, cache_read_tokens)
  on public.ai_suggestions to authenticated;
grant update (status) on public.ai_suggestions to authenticated;
-- Cada um vê as próprias sugestões; admin/gestor veem todas (acompanhamento de uso e custo).
create policy ai_sug_select on public.ai_suggestions for select to authenticated
  using (org_id = app.current_org() and (created_by = auth.uid() or app.has_role('admin', 'gestor')));
create policy ai_sug_insert on public.ai_suggestions for insert to authenticated with check (
  org_id = app.current_org() and created_by = auth.uid()
  and exists (select 1 from public.conversations c where c.id = conversation_id)
);
create policy ai_sug_update on public.ai_suggestions for update to authenticated
  using (org_id = app.current_org() and created_by = auth.uid())
  with check (org_id = app.current_org() and created_by = auth.uid());

-- Uso da IA no mês pela organização inteira (para o limite mensal), sem expor as sugestões alheias.
create function public.ai_usage_this_month() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.ai_suggestions s
   where s.org_id = app.current_org()
     and s.created_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
$$;
revoke execute on function public.ai_usage_this_month() from public, anon;
grant execute on function public.ai_usage_this_month() to authenticated;

-- ---------------------------------------------------------------------------
-- LGPD: anonimização (direito de eliminação) — somente administradores.
-- Apaga conversas e mensagens, remove dados pessoais e mantém o histórico de
-- consentimento (prova legal), registrando o descadastro.
-- ---------------------------------------------------------------------------
create function public.anonymize_client(p_client uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := app.current_org();
begin
  if v_org is null or not app.has_role('admin') then
    raise exception 'Somente administradores podem anonimizar clientes' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client and c.org_id = v_org) then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  delete from public.conversations c where c.org_id = v_org and c.client_id = p_client; -- mensagens em cascata
  update public.tasks t set client_id = null where t.org_id = v_org and t.client_id = p_client;
  update public.deals d set title = 'Oportunidade anonimizada' where d.org_id = v_org and d.client_id = p_client;
  update public.clients c set
    name = 'Titular anonimizado',
    phone = '000' || left(regexp_replace(c.id::text, '\D', '', 'g') || '0000000000', 10),
    email = '', city = '', notes = '', tags = array['Anonimizado'], services = '{}', owner_id = null
   where c.id = p_client and c.org_id = v_org;
  if (select c.consent_status from public.clients c where c.id = p_client) <> 'opt_out' then
    insert into public.consent_events (org_id, client_id, status, source, note, by_user_id)
    values (v_org, p_client, 'opt_out', 'manual', 'Dados anonimizados a pedido do titular (LGPD).', auth.uid());
  end if;
  insert into public.audit_logs (org_id, user_id, action, entity, entity_id, details)
  values (v_org, auth.uid(), 'lgpd.anonimizacao', 'cliente', p_client::text, 'Dados pessoais e conversas removidos a pedido do titular.');
end $$;
revoke execute on function public.anonymize_client(uuid) from public, anon;
grant execute on function public.anonymize_client(uuid) to authenticated;
