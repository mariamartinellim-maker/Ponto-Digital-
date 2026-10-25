-- =============================================================================
-- Ponto Digital CRM — esquema inicial (Supabase / PostgreSQL 15+)
--
-- Segurança em camadas:
--   1. Privilégios explícitos por coluna para o papel "authenticated" (o Supabase
--      libera TUDO por padrão; aqui revogamos e concedemos só o necessário).
--   2. Row Level Security em todas as tabelas: cada usuário só enxerga a própria
--      organização, com regras por perfil (admin / gestor / atendente).
--   3. Chaves estrangeiras compostas (org_id, id): é impossível ligar um registro
--      a outro de OUTRA organização, mesmo conhecendo o ID.
--   4. Auditoria e histórico de consentimento somente-inclusão (nem o servidor
--      altera ou apaga); o status de consentimento do cliente só muda pelo histórico.
--   5. Campos sensíveis (status de modelo da Meta, modo "live" de campanha, número
--      de WhatsApp, IP da auditoria) só podem ser gravados pelo servidor (service_role).
--
-- Primeira organização e administrador: veja a função app.bootstrap_first_admin
-- no final deste arquivo e o passo a passo em docs/SUPABASE.md.
-- =============================================================================

create schema if not exists app;
revoke all on schema app from public;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type app.role as enum ('admin', 'gestor', 'atendente');
create type app.stage as enum ('novo_lead', 'em_atendimento', 'proposta_enviada', 'fechado', 'perdido');
create type app.consent_status as enum ('opt_in', 'opt_out', 'desconhecido');
create type app.consent_source as enum ('formulario', 'whatsapp', 'importacao', 'manual', 'palavra_chave', 'campanha');
create type app.conversation_status as enum ('aberta', 'pendente', 'resolvida');
create type app.message_origin as enum ('cliente', 'crm', 'app_business', 'campanha', 'historico', 'sistema');
create type app.message_status as enum ('recebida', 'simulada', 'enviada', 'entregue', 'lida', 'falhou');
create type app.template_category as enum ('MARKETING', 'UTILITY', 'AUTHENTICATION');
create type app.template_status as enum ('APPROVED', 'PENDING', 'REJECTED');
create type app.campaign_status as enum ('rascunho', 'concluida', 'cancelada');
create type app.recipient_status as enum ('simulada', 'enviada', 'entregue', 'lida', 'falhou', 'respondeu', 'descadastrou');
create type app.task_type as enum ('retorno', 'ligacao', 'reuniao', 'proposta', 'outro');

-- ---------------------------------------------------------------------------
-- Organizações e perfis (perfil = usuário do Supabase Auth + organização + papel)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  -- phone_number_id da Cloud API, para rotear webhooks (gravado só pelo servidor)
  wa_phone_number_id text unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  email text not null,
  role app.role not null default 'atendente',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (org_id, id)
);

-- Funções usadas nas políticas. SECURITY DEFINER lê o perfil sem recursão de RLS;
-- search_path vazio impede sequestro de objetos.
create function app.current_org() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.org_id from public.profiles p where p.id = auth.uid() and p.active
$$;

create function app.user_role() returns app.role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create function app.has_role(variadic roles app.role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.user_role() = any (roles), false)
$$;

-- Nunca deixar a organização sem administrador ativo.
create function app.guard_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (
       select 1 from public.profiles p
       where p.org_id = old.org_id and p.id <> old.id and p.role = 'admin' and p.active
     ) then
    raise exception 'A organização precisa manter pelo menos um administrador ativo';
  end if;
  return coalesce(new, old);
end $$;
create trigger profiles_guard_last_admin before update or delete on public.profiles
  for each row when (current_user <> 'postgres') execute function app.guard_last_admin();

-- ---------------------------------------------------------------------------
-- Clientes, consentimento e oportunidades
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  -- chave de deduplicação (Brasil: ignora o nono dígito)
  phone_key text generated always as (
    case when phone ~ '^55[0-9]{2}9[0-9]{8}$' then substr(phone, 1, 4) || substr(phone, 6) else phone end
  ) stored,
  email text not null default '' check (length(email) <= 160),
  city text not null default '' check (length(city) <= 80),
  services text[] not null default '{}',
  tags text[] not null default '{}',
  notes text not null default '' check (length(notes) <= 4000),
  owner_id uuid,
  -- Espelho do último registro em consent_events (atualizado só por gatilho)
  consent_status app.consent_status not null default 'desconhecido',
  consent_source app.consent_source,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_contact_at timestamptz,
  unique (org_id, phone_key),
  unique (org_id, id),
  foreign key (org_id, owner_id) references public.profiles (org_id, id) on delete set null (owner_id)
);
create index on public.clients (org_id, name);
create index on public.clients (org_id, city);

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  status app.consent_status not null check (status <> 'desconhecido'),
  source app.consent_source not null,
  note text not null default '' check (length(note) <= 500),
  -- quem registrou (sem FK: a prova permanece mesmo se o usuário for removido)
  by_user_id uuid,
  at timestamptz not null default now(),
  foreign key (org_id, client_id) references public.clients (org_id, id)
);
create index on public.consent_events (client_id, at desc);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  title text not null check (length(title) between 1 and 140),
  value_cents bigint not null default 0 check (value_cents >= 0),
  stage app.stage not null default 'novo_lead',
  owner_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete cascade,
  foreign key (org_id, owner_id) references public.profiles (org_id, id) on delete set null (owner_id)
);
create index on public.deals (org_id, stage);

-- ---------------------------------------------------------------------------
-- Atendimento (WhatsApp)
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  assignee_id uuid,
  status app.conversation_status not null default 'aberta',
  unread integer not null default 0 check (unread >= 0),
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  unique (org_id, client_id),
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete cascade,
  foreign key (org_id, assignee_id) references public.profiles (org_id, id) on delete set null (assignee_id)
);
create index on public.conversations (org_id, status, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  origin app.message_origin not null,
  body text not null check (length(body) <= 4096),
  status app.message_status not null,
  -- idempotência dos webhooks: a Meta pode reenviar o mesmo evento
  wa_message_id text,
  author_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, wa_message_id),
  foreign key (org_id, conversation_id) references public.conversations (org_id, id) on delete cascade,
  foreign key (org_id, author_id) references public.profiles (org_id, id) on delete set null (author_id)
);
create index on public.messages (conversation_id, created_at);

-- Mantém a conversa e o cliente atualizados a cada mensagem (janela de 24h incluída).
create function app.on_message_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_client uuid;
begin
  update public.conversations c set
    last_message_at = greatest(c.last_message_at, new.created_at),
    last_inbound_at = case when new.direction = 'in' and new.origin <> 'historico'
                           then greatest(coalesce(c.last_inbound_at, new.created_at), new.created_at) else c.last_inbound_at end,
    unread = c.unread + case when new.direction = 'in' and new.origin <> 'historico' then 1 else 0 end,
    status = case when new.direction = 'in' and new.origin <> 'historico' and c.status = 'resolvida'
                  then 'aberta'::app.conversation_status else c.status end
  where c.id = new.conversation_id
  returning c.client_id into v_client;
  update public.clients set last_contact_at = greatest(coalesce(last_contact_at, new.created_at), new.created_at)
  where id = v_client;
  return null;
end $$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function app.on_message_insert();

create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  shortcut text not null check (shortcut ~ '^[a-z0-9_-]{2,20}$'),
  title text not null check (length(title) between 2 and 60),
  body text not null check (length(body) <= 1000),
  unique (org_id, shortcut)
);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_]{3,60}$'),
  category app.template_category not null,
  language text not null default 'pt_BR' check (language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  body text not null check (length(body) <= 1024),
  -- definido pela Meta (gravado só pelo servidor)
  status app.template_status not null default 'PENDING',
  meta_template_id text,
  created_at timestamptz not null default now(),
  unique (org_id, name, language),
  unique (org_id, id)
);

-- ---------------------------------------------------------------------------
-- Campanhas
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(name) between 3 and 120),
  template_id uuid not null,
  segment jsonb not null default '{"cities":[],"services":[],"stages":[],"tags":[]}',
  -- "live" (envio real) só pode ser definido pelo servidor
  mode text not null default 'simulacao' check (mode in ('simulacao', 'live')),
  status app.campaign_status not null default 'rascunho',
  created_by uuid,
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  excluded_no_consent integer not null default 0,
  excluded_opt_out integer not null default 0,
  unique (org_id, id),
  foreign key (org_id, template_id) references public.message_templates (org_id, id),
  foreign key (org_id, created_by) references public.profiles (org_id, id) on delete set null (created_by)
);

create table public.campaign_recipients (
  campaign_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  status app.recipient_status not null,
  wa_message_id text,
  primary key (campaign_id, client_id),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete cascade,
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete cascade
);
create index on public.campaign_recipients (org_id, wa_message_id);

-- Trava no banco: nenhum destinatário de campanha sem consentimento (opt-in).
create function app.check_recipient_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select c.consent_status from public.clients c where c.id = new.client_id and c.org_id = new.org_id)
     is distinct from 'opt_in' then
    raise exception 'Destinatário sem consentimento (opt-in) não pode receber campanhas'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger campaign_recipient_consent before insert on public.campaign_recipients
  for each row execute function app.check_recipient_consent();

-- ---------------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (length(title) between 2 and 140),
  type app.task_type not null default 'outro',
  client_id uuid,
  assignee_id uuid,
  due_at timestamptz not null,
  done boolean not null default false,
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete set null (client_id),
  foreign key (org_id, assignee_id) references public.profiles (org_id, id) on delete set null (assignee_id)
);
create index on public.tasks (org_id, assignee_id, due_at);

-- ---------------------------------------------------------------------------
-- Auditoria e webhooks
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- sem FK: o registro histórico permanece mesmo se o usuário for removido
  user_id uuid,
  action text not null check (length(action) <= 80),
  entity text not null check (length(entity) <= 40),
  entity_id text,
  details text not null default '' check (length(details) <= 2000),
  ip inet,
  at timestamptz not null default now()
);
create index on public.audit_logs (org_id, at desc);

create table public.webhook_events (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  field text not null,
  summary text not null,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Gatilhos de integridade
-- ---------------------------------------------------------------------------

-- Somente-inclusão: só o dono do banco (manutenção/migrações e exclusão em cascata
-- de uma organização inteira) pode alterar ou apagar. Nem o service_role pode.
create function app.deny_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Registro somente-inclusão: % não permitido em %', tg_op, tg_table_name;
end $$;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row when (current_user <> 'postgres') execute function app.deny_change();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement when (current_user <> 'postgres') execute function app.deny_change();
create trigger consent_events_append_only before update or delete on public.consent_events
  for each row when (current_user <> 'postgres') execute function app.deny_change();
create trigger consent_events_no_truncate before truncate on public.consent_events
  for each statement when (current_user <> 'postgres') execute function app.deny_change();

-- O status de consentimento do cliente é sempre o do último registro do histórico.
create function app.sync_client_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.clients
     set consent_status = new.status, consent_source = new.source, consent_at = new.at, updated_at = now()
   where id = new.client_id and org_id = new.org_id;
  return null;
end $$;
create trigger consent_events_sync after insert on public.consent_events
  for each row execute function app.sync_client_consent();

create function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger clients_touch before update on public.clients for each row execute function app.touch_updated_at();
create trigger deals_touch before update on public.deals for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privilégios: revoga o padrão amplo do Supabase e concede só o necessário
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke truncate on all tables in schema public from service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;

grant usage on schema app to authenticated, service_role;
revoke execute on all functions in schema app from public;
grant execute on function app.current_org(), app.user_role(), app.has_role(app.role[]) to authenticated, service_role;

grant select on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

grant select on public.profiles to authenticated;
grant insert (id, org_id, name, email, role, active) on public.profiles to authenticated;
grant update (name, email, role, active) on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

grant select on public.clients to authenticated;
grant insert (id, org_id, name, phone, email, city, services, tags, notes, owner_id) on public.clients to authenticated;
grant update (name, phone, email, city, services, tags, notes, owner_id) on public.clients to authenticated;

grant select on public.consent_events to authenticated;
grant insert (id, org_id, client_id, status, source, note, by_user_id) on public.consent_events to authenticated;

grant select, delete on public.deals to authenticated;
grant insert (id, org_id, client_id, title, value_cents, stage, owner_id, closed_at) on public.deals to authenticated;
grant update (title, value_cents, stage, owner_id, closed_at) on public.deals to authenticated;

grant select on public.conversations to authenticated;
grant insert (id, org_id, client_id, assignee_id, status) on public.conversations to authenticated;
grant update (assignee_id, status, unread) on public.conversations to authenticated;

grant select on public.messages to authenticated;
grant insert (id, org_id, conversation_id, direction, origin, body, status, wa_message_id, author_id) on public.messages to authenticated;

grant select, delete on public.quick_replies to authenticated;
grant insert (id, org_id, shortcut, title, body) on public.quick_replies to authenticated;
grant update (shortcut, title, body) on public.quick_replies to authenticated;

grant select, delete on public.message_templates to authenticated;
grant insert (id, org_id, name, category, language, body) on public.message_templates to authenticated;

grant select, delete on public.campaigns to authenticated;
grant insert (id, org_id, name, template_id, segment, created_by) on public.campaigns to authenticated;
grant update (name, segment, status, executed_at, excluded_no_consent, excluded_opt_out) on public.campaigns to authenticated;

grant select on public.campaign_recipients to authenticated;
grant insert (campaign_id, org_id, client_id, status, wa_message_id) on public.campaign_recipients to authenticated;

grant select, delete on public.tasks to authenticated;
grant insert (id, org_id, title, type, client_id, assignee_id, due_at, done, notes) on public.tasks to authenticated;
grant update (title, type, client_id, assignee_id, due_at, done, notes) on public.tasks to authenticated;

grant select on public.audit_logs to authenticated;
grant insert (org_id, user_id, action, entity, entity_id, details) on public.audit_logs to authenticated;

grant select on public.webhook_events to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.consent_events enable row level security;
alter table public.deals enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.quick_replies enable row level security;
alter table public.message_templates enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.tasks enable row level security;
alter table public.audit_logs enable row level security;
alter table public.webhook_events enable row level security;

-- Organização: todos leem a própria; só admin renomeia
create policy org_select on public.organizations for select to authenticated using (id = app.current_org());
create policy org_update on public.organizations for update to authenticated
  using (id = app.current_org() and app.has_role('admin')) with check (id = app.current_org());

-- Perfis: a equipe se enxerga; só admin cria, altera e remove (na própria organização)
create policy profiles_select on public.profiles for select to authenticated using (org_id = app.current_org());
create policy profiles_insert on public.profiles for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin'));
create policy profiles_update on public.profiles for update to authenticated
  using (org_id = app.current_org() and app.has_role('admin')) with check (org_id = app.current_org());
create policy profiles_delete on public.profiles for delete to authenticated
  using (org_id = app.current_org() and app.has_role('admin'));

-- Clientes: equipe lê, cria e edita. Exclusão não existe (LGPD = anonimização).
create policy clients_select on public.clients for select to authenticated using (org_id = app.current_org());
create policy clients_insert on public.clients for insert to authenticated with check (org_id = app.current_org());
create policy clients_update on public.clients for update to authenticated
  using (org_id = app.current_org()) with check (org_id = app.current_org());

-- Consentimento: registrado sempre em nome de quem está logado
create policy consent_select on public.consent_events for select to authenticated using (org_id = app.current_org());
create policy consent_insert on public.consent_events for insert to authenticated
  with check (org_id = app.current_org() and by_user_id = auth.uid());

-- Oportunidades: equipe move no funil; só admin/gestor excluem
create policy deals_select on public.deals for select to authenticated using (org_id = app.current_org());
create policy deals_insert on public.deals for insert to authenticated with check (org_id = app.current_org());
create policy deals_update on public.deals for update to authenticated
  using (org_id = app.current_org()) with check (org_id = app.current_org());
create policy deals_delete on public.deals for delete to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor'));

-- Conversas: admin/gestor veem todas; atendente vê as suas e as sem responsável
-- e não as transfere para outra pessoa.
create policy conv_select on public.conversations for select to authenticated using (
  org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid() or assignee_id is null)
);
create policy conv_insert on public.conversations for insert to authenticated with check (
  org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid() or assignee_id is null)
);
create policy conv_update on public.conversations for update to authenticated using (
  org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid() or assignee_id is null)
) with check (
  org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid() or assignee_id is null)
);

-- Mensagens: usuário só grava mensagens de saída do CRM, em seu nome, em conversa que pode ver.
-- Mensagens recebidas, ecos do App Business, histórico e status chegam pelo servidor (webhook).
create policy msg_select on public.messages for select to authenticated using (
  org_id = app.current_org() and exists (select 1 from public.conversations c where c.id = conversation_id)
);
create policy msg_insert on public.messages for insert to authenticated with check (
  org_id = app.current_org()
  and direction = 'out' and origin = 'crm' and author_id = auth.uid() and status in ('simulada', 'enviada')
  and exists (select 1 from public.conversations c where c.id = conversation_id)
);

create policy qr_select on public.quick_replies for select to authenticated using (org_id = app.current_org());
create policy qr_insert on public.quick_replies for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor'));
create policy qr_update on public.quick_replies for update to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor')) with check (org_id = app.current_org());
create policy qr_delete on public.quick_replies for delete to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor'));

-- Modelos: admin/gestor criam (sempre PENDENTE) e excluem; o status vem da Meta via servidor.
create policy tpl_select on public.message_templates for select to authenticated using (org_id = app.current_org());
create policy tpl_insert on public.message_templates for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor'));
create policy tpl_delete on public.message_templates for delete to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor'));

-- Campanhas: todos leem; admin/gestor criam, executam (simulação) e excluem rascunhos.
create policy camp_select on public.campaigns for select to authenticated using (org_id = app.current_org());
create policy camp_insert on public.campaigns for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor'));
create policy camp_update on public.campaigns for update to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor')) with check (org_id = app.current_org());
create policy camp_delete on public.campaigns for delete to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor') and status = 'rascunho');

create policy camp_rcpt_select on public.campaign_recipients for select to authenticated using (org_id = app.current_org());
create policy camp_rcpt_insert on public.campaign_recipients for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor'));

-- Tarefas: todos veem a agenda da equipe; admin/gestor gerenciam todas, atendente só as próprias.
create policy tasks_select on public.tasks for select to authenticated using (org_id = app.current_org());
create policy tasks_insert on public.tasks for insert to authenticated
  with check (org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid()));
create policy tasks_update on public.tasks for update to authenticated
  using (org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid()))
  with check (org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid()));
create policy tasks_delete on public.tasks for delete to authenticated
  using (org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid()));

-- Auditoria: cada usuário registra só as próprias ações; só admin lê.
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (org_id = app.current_org() and user_id = auth.uid());
create policy audit_select on public.audit_logs for select to authenticated
  using (org_id = app.current_org() and app.has_role('admin'));

-- Webhooks: só admin lê; gravação apenas pelo servidor.
create policy webhook_select on public.webhook_events for select to authenticated
  using (org_id = app.current_org() and app.has_role('admin'));

-- ---------------------------------------------------------------------------
-- Criação segura da PRIMEIRA organização e do administrador
--
-- 1. No painel do Supabase: Authentication → Users → "Add user" (e-mail + senha forte,
--    "Auto Confirm User" marcado).
-- 2. No SQL Editor (executa como dono do banco):
--      select app.bootstrap_first_admin('seu-email@dominio.com', 'Ponto Digital', 'Seu Nome');
--
-- Só funciona enquanto NÃO existir nenhuma organização, e não pode ser chamada pela API
-- (nem por usuários logados, nem pelo service_role).
-- ---------------------------------------------------------------------------
create function app.bootstrap_first_admin(p_email text, p_org_name text, p_admin_name text)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_user uuid;
  v_org uuid;
begin
  if exists (select 1 from public.organizations) then
    raise exception 'Já existe uma organização cadastrada. O bootstrap só pode ser usado uma vez.';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'Usuário % não encontrado em Authentication → Users. Crie-o primeiro.', p_email;
  end if;
  insert into public.organizations (name) values (trim(p_org_name)) returning id into v_org;
  insert into public.profiles (id, org_id, name, email, role, active)
  values (v_user, v_org, trim(p_admin_name), lower(trim(p_email)), 'admin', true);
  insert into public.audit_logs (org_id, user_id, action, entity, entity_id, details)
  values (v_org, v_user, 'sistema.bootstrap', 'organizacao', v_org::text, 'Organização e administrador inicial criados.');
  return v_org;
end $$;
revoke execute on function app.bootstrap_first_admin(text, text, text) from public, anon, authenticated, service_role;
