-- =============================================================================
-- Teste da Fase 2 (WhatsApp oficial, distribuição, IA, LGPD).
-- Para um PostgreSQL LOCAL de testes (15+) — NÃO execute no projeto Supabase.
--
--   createdb pdcrm_f2 && psql -d pdcrm_f2 -f supabase/tests/fase2-test.sql
--   (rode a partir da pasta Ponto-Digital-CRM)
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Padrão do Supabase: tudo que for criado em public é liberado para os papéis da API.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

\i supabase/migrations/20261024000000_inicial.sql
\i supabase/migrations/20261025000000_fase2_whatsapp_ia.sql

create temp table resultado (ok boolean, item text);
grant all on resultado to public;
create function pg_temp.ok(b boolean, item text) returns void language plpgsql as $$
begin
  insert into resultado values (b, item);
  raise notice '%: %', case when b then 'OK   ' else 'FALHA' end, item;
end $$;
create function pg_temp.ev(j text) returns jsonb language sql as $$ select j::jsonb $$;

insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@a.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'ana@a.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'pedro@a.com'),
  ('00000000-0000-0000-0000-0000000000a4', 'gestor@a.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'admin@b.com');
select app.bootstrap_first_admin('admin@a.com', 'Ponto Digital', 'Admin A');
insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000000b', 'Outra Agência');
insert into public.profiles (id, org_id, name, email, role)
  select '00000000-0000-0000-0000-0000000000a2'::uuid, id, 'Ana', 'ana@a.com', 'atendente'::app.role from public.organizations where name = 'Ponto Digital'
  union all select '00000000-0000-0000-0000-0000000000a3'::uuid, id, 'Pedro', 'pedro@a.com', 'atendente'::app.role from public.organizations where name = 'Ponto Digital'
  union all select '00000000-0000-0000-0000-0000000000a4'::uuid, id, 'Gestor', 'gestor@a.com', 'gestor'::app.role from public.organizations where name = 'Ponto Digital'
  union all select '00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-00000000000b'::uuid, 'Admin B', 'admin@b.com', 'admin'::app.role;

-- ---------------------------------------------------------------------------
-- Privilégios: só o servidor recebe webhooks e vê a conta do WhatsApp
-- ---------------------------------------------------------------------------
do $$ begin
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.wa_ingest_event(uuid,jsonb)', 'execute')
                 and not has_function_privilege('anon', 'public.wa_ingest_event(uuid,jsonb)', 'execute'),
    'usuários e visitantes não podem gravar eventos do WhatsApp');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.wa_ingest_event(uuid,jsonb)', 'execute'),
    'o servidor (service_role) grava eventos do WhatsApp');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.whatsapp_accounts', 'select')
                 and not has_table_privilege('anon', 'public.whatsapp_accounts', 'select'),
    'token e dados da conta do WhatsApp são invisíveis para usuários e visitantes');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'app.next_in_rotation(uuid)', 'execute'),
    'usuários não manipulam o rodízio diretamente');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.anonymize_client(uuid)', 'execute'),
    'visitantes não executam a anonimização');
end $$;

-- ---------------------------------------------------------------------------
-- Webhook: mensagem recebida cria cliente, oportunidade e conversa
-- ---------------------------------------------------------------------------
set role service_role;
do $$ declare a uuid; r jsonb; r2 jsonb; n int; begin
  select id into a from public.organizations where name = 'Ponto Digital';
  r := public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.1","phone":"5511988887777","name":"Joana Cliente","text":"Oi, quero um site","timestamp":1761400000}'));
  perform pg_temp.ok(r->>'result' = 'inserted' and (r->>'newClient')::boolean, 'mensagem nova de número desconhecido é registrada');
  perform pg_temp.ok((select name from public.clients where phone = '5511988887777') = 'Joana Cliente'
                 and (select consent_status from public.clients where phone = '5511988887777') = 'desconhecido',
    'cliente novo criado com o nome do perfil e sem consentimento de marketing presumido');
  perform pg_temp.ok(exists (select 1 from public.deals d join public.clients c on c.id = d.client_id
                             where c.phone = '5511988887777' and d.stage = 'novo_lead'),
    'cliente novo entra no funil como Novo Lead');
  perform pg_temp.ok((select unread from public.conversations where id = (r->>'conversationId')::uuid) = 1
                 and (select status from public.conversations where id = (r->>'conversationId')::uuid) = 'aberta',
    'conversa aberta com 1 mensagem não lida');
  -- reenvio (a Meta reenvia em caso de falha)
  r2 := public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.1","phone":"5511988887777","text":"Oi, quero um site"}'));
  select count(*) into n from public.messages where wa_message_id = 'wamid.1';
  perform pg_temp.ok(r2->>'result' = 'duplicate' and n = 1, 'evento reenviado não duplica a mensagem');
  -- mesmo cliente com/sem nono dígito
  r := public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.2","phone":"551188887777","text":"Também quero tráfego"}'));
  perform pg_temp.ok(not (r->>'newClient')::boolean and (select count(*) from public.clients where org_id = a) = 1,
    'número sem o nono dígito é reconhecido como o mesmo cliente');
  -- mesmo número em outra organização é outro cliente
  r := public.wa_ingest_event('00000000-0000-0000-0000-00000000000b', pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.1","phone":"5511988887777","text":"Oi"}'));
  perform pg_temp.ok(r->>'result' = 'inserted', 'organizações não compartilham clientes nem mensagens');
end $$;

-- Coexistência: eco do app, histórico e contatos
do $$ declare a uuid; r jsonb; c uuid; u int; begin
  select id into a from public.organizations where name = 'Ponto Digital';
  r := public.wa_ingest_event(a, pg_temp.ev('{"kind":"echo","waMessageId":"wamid.eco1","phone":"5511988887777","text":"Respondi pelo celular","timestamp":1761400100}'));
  perform pg_temp.ok(exists (select 1 from public.messages where wa_message_id = 'wamid.eco1' and direction = 'out' and origin = 'app_business'),
    'mensagem enviada pelo app WhatsApp Business no celular aparece no CRM');
  r := public.wa_ingest_event(a, pg_temp.ev('{"kind":"history","waMessageId":"wamid.h1","phone":"5521977776666","direction":"in","text":"Mensagem antiga","timestamp":1750000000}'));
  c := (r->>'conversationId')::uuid;
  select unread into u from public.conversations where id = c;
  perform pg_temp.ok(u = 0 and (select status from public.conversations where id = c) = 'resolvida'
                 and (select last_inbound_at from public.conversations where id = c) is null,
    'histórico sincronizado não gera não lidas nem abre a janela de 24h');
  perform public.wa_ingest_event(a, pg_temp.ev('{"kind":"contact_sync","phone":"5531966665555","name":"Carlos do App","action":"add"}'));
  perform pg_temp.ok(exists (select 1 from public.wa_contacts where name = 'Carlos do App')
                 and not exists (select 1 from public.clients where phone = '5531966665555'),
    'contatos do app são guardados, sem virar clientes automaticamente');
  r := public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.3","phone":"5531966665555","text":"Olá"}'));
  perform pg_temp.ok((select name from public.clients where phone = '5531966665555') = 'Carlos do App',
    'quem está nos contatos do app chega com o nome salvo no celular');
  perform public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.4","phone":"5541955554444","text":"Oi"}'));
  perform public.wa_ingest_event(a, pg_temp.ev('{"kind":"contact_sync","phone":"5541955554444","name":"Bia","action":"add"}'));
  perform pg_temp.ok((select name from public.clients where phone = '5541955554444') = 'Bia',
    'contato sincronizado depois dá nome ao cliente criado automaticamente');
  perform public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.m1","phone":"5541955554444","text":"[imagem] logo","media":{"type":"image","id":"MEDIA123","mime":"image/jpeg","caption":"logo"}}'));
  perform pg_temp.ok((select media->>'id' from public.messages where wa_message_id = 'wamid.m1') = 'MEDIA123',
    'mídia recebida guarda a referência oficial da Meta');
end $$;

-- Status de entrega só avança
do $$ declare a uuid; conv uuid; begin
  select id into a from public.organizations where name = 'Ponto Digital';
  select conversation_id into conv from public.messages where wa_message_id = 'wamid.1' and org_id = a;
  insert into public.messages (org_id, conversation_id, direction, origin, body, status, wa_message_id)
  values (a, conv, 'out', 'crm', 'Olá Joana!', 'enviada', 'wamid.out1');
  perform public.wa_ingest_event(a, pg_temp.ev('{"kind":"status","waMessageId":"wamid.out1","status":"read"}'));
  perform public.wa_ingest_event(a, pg_temp.ev('{"kind":"status","waMessageId":"wamid.out1","status":"delivered"}'));
  perform pg_temp.ok((select status from public.messages where wa_message_id = 'wamid.out1') = 'lida',
    'status fora de ordem não regride (lida continua lida)');
  insert into public.messages (org_id, conversation_id, direction, origin, body, status, wa_message_id)
  values (a, conv, 'out', 'crm', 'Teste', 'enviada', 'wamid.out2');
  perform public.wa_ingest_event(a, pg_temp.ev('{"kind":"status","waMessageId":"wamid.out2","status":"failed","error":"Número sem WhatsApp"}'));
  perform pg_temp.ok((select status::text || '|' || error from public.messages where wa_message_id = 'wamid.out2') = 'falhou|Número sem WhatsApp',
    'falha de entrega é registrada com o motivo');
  insert into public.message_templates (org_id, name, category, body) values (a, 'boas_vindas', 'UTILITY', 'Olá {{1}}!');
  perform public.wa_ingest_event(a, pg_temp.ev('{"kind":"template_status","name":"boas_vindas","language":"pt_BR","status":"APPROVED","metaTemplateId":"T1"}'));
  perform pg_temp.ok((select status from public.message_templates where name = 'boas_vindas') = 'APPROVED',
    'aprovação de modelo pela Meta atualiza o status');
end $$;

-- Descadastro por palavra-chave
do $$ declare a uuid; begin
  select id into a from public.organizations where name = 'Ponto Digital';
  perform public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.sair","phone":"5511988887777","text":"SAIR","optOut":true}'));
  perform pg_temp.ok((select consent_status from public.clients where phone = '5511988887777' and org_id = a) = 'opt_out'
                 and exists (select 1 from public.consent_events e join public.clients c on c.id = e.client_id
                             where c.phone = '5511988887777' and e.source = 'palavra_chave'),
    'SAIR descadastra e fica registrado no histórico de consentimento');
end $$;

-- ---------------------------------------------------------------------------
-- Distribuição por rodízio
-- ---------------------------------------------------------------------------
reset role;
update public.organizations set wa_distribution = 'rodizio' where name = 'Ponto Digital';
update public.profiles set in_rotation = true where email in ('ana@a.com', 'pedro@a.com');
set role service_role;
do $$ declare a uuid; r1 jsonb; r2 jsonb; r3 jsonb; x uuid; y uuid; z uuid; begin
  select id into a from public.organizations where name = 'Ponto Digital';
  r1 := public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.r1","phone":"5511911110001","text":"Oi"}'));
  r2 := public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.r2","phone":"5511911110002","text":"Oi"}'));
  r3 := public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.r3","phone":"5511911110003","text":"Oi"}'));
  select assignee_id into x from public.conversations where id = (r1->>'conversationId')::uuid;
  select assignee_id into y from public.conversations where id = (r2->>'conversationId')::uuid;
  select assignee_id into z from public.conversations where id = (r3->>'conversationId')::uuid;
  perform pg_temp.ok(x is not null and y is not null and x <> y and z = x,
    'rodízio alterna os atendimentos entre os membros participantes');
  perform pg_temp.ok(x in ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3')
                 and y in ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3'),
    'só quem está no rodízio recebe atendimentos');
end $$;
reset role;
update public.profiles set active = false where email = 'pedro@a.com';
set role service_role;
do $$ declare a uuid; r jsonb; begin
  select id into a from public.organizations where name = 'Ponto Digital';
  r := public.wa_ingest_event(a, pg_temp.ev('{"kind":"inbound","waMessageId":"wamid.r4","phone":"5511911110004","text":"Oi"}'));
  perform pg_temp.ok((select assignee_id from public.conversations where id = (r->>'conversationId')::uuid) = '00000000-0000-0000-0000-0000000000a2',
    'usuário desativado sai do rodízio');
end $$;

-- ---------------------------------------------------------------------------
-- Permissões dos usuários
-- ---------------------------------------------------------------------------
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2'; -- atendente

do $$ begin
  begin
    perform public.wa_ingest_event((select id from public.organizations), '{"kind":"inbound","waMessageId":"x","phone":"5511900000000","text":"forjado"}');
    perform pg_temp.ok(false, 'atendente não consegue forjar mensagem recebida');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'atendente não consegue forjar mensagem recebida');
  end;
  update public.profiles set in_rotation = false where email = 'ana@a.com';
  perform pg_temp.ok((select in_rotation from public.profiles where email = 'ana@a.com'), 'atendente não se retira (nem se inclui) no rodízio');
  begin
    update public.organizations set wa_distribution = 'manual';
    perform pg_temp.ok((select wa_distribution from public.organizations) = 'rodizio', 'atendente não altera a forma de distribuição');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'atendente não altera a forma de distribuição');
  end;
  begin
    insert into public.ai_knowledge (org_id, services, updated_by) values (app.current_org(), 'x', auth.uid());
    perform pg_temp.ok(false, 'atendente não edita a base de conhecimento da IA');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'atendente não edita a base de conhecimento da IA');
  end;
  begin
    perform public.anonymize_client((select id from public.clients limit 1));
    perform pg_temp.ok(false, 'atendente não anonimiza clientes');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'atendente não anonimiza clientes');
  end;
  begin
    insert into public.messages (org_id, conversation_id, direction, origin, body, status, author_id)
    select app.current_org(), c.id, 'out', 'campanha', 'x', 'simulada', auth.uid() from public.conversations c limit 1;
    perform pg_temp.ok(false, 'atendente não grava mensagens de campanha');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'atendente não grava mensagens de campanha');
  end;
  perform pg_temp.ok((select count(*) from public.wa_contacts) > 0, 'equipe vê os contatos sincronizados da própria organização');
end $$;

-- Sugestões da IA: atendente registra as próprias; não vê as dos outros
do $$ declare c uuid; begin
  select id into c from public.conversations where assignee_id = auth.uid() limit 1;
  insert into public.ai_suggestions (org_id, conversation_id, created_by, model, suggestion)
  values (app.current_org(), c, auth.uid(), 'claude-opus-5-5', 'Olá! Posso ajudar?');
  perform pg_temp.ok((select count(*) from public.ai_suggestions) = 1, 'atendente registra a própria sugestão da IA');
  begin
    insert into public.ai_suggestions (org_id, conversation_id, created_by, model, suggestion)
    values (app.current_org(), c, '00000000-0000-0000-0000-0000000000a3', 'claude-opus-5-5', 'forjada');
    perform pg_temp.ok(false, 'sugestão não pode ser registrada em nome de outra pessoa');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'sugestão não pode ser registrada em nome de outra pessoa');
  end;
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4'; -- gestor
do $$ begin
  insert into public.ai_knowledge (org_id, enabled, services, prices, updated_by)
  values (app.current_org(), true, 'Sites, tráfego pago', 'Site a partir de R$ 2.500', auth.uid());
  perform pg_temp.ok((select services from public.ai_knowledge) = 'Sites, tráfego pago', 'gestor edita a base de conhecimento da IA');
  perform pg_temp.ok((select count(*) from public.ai_suggestions) = 1, 'gestor acompanha as sugestões da equipe');
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1'; -- admin de outra organização
do $$ begin
  perform pg_temp.ok((select count(*) from public.ai_knowledge) = 0 and (select count(*) from public.ai_suggestions) = 0
                 and (select count(*) from public.wa_contacts) = 0,
    'outra organização não vê IA nem contatos da Ponto Digital');
  begin
    perform public.anonymize_client((select id from public.clients c where c.phone = '5511911110001' limit 1));
    perform pg_temp.ok(false, 'admin de outra organização não anonimiza clientes alheios');
  exception when others then perform pg_temp.ok(true, 'admin de outra organização não anonimiza clientes alheios');
  end;
end $$;

-- LGPD: anonimização pelo administrador
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ declare c uuid; n int; begin
  select id into c from public.clients where phone = '5511988887777';
  perform public.anonymize_client(c);
  select count(*) into n from public.messages m join public.conversations v on v.id = m.conversation_id where v.client_id = c;
  perform pg_temp.ok(n = 0 and (select name from public.clients where id = c) = 'Titular anonimizado'
                 and (select phone from public.clients where id = c) like '000%',
    'anonimização remove dados pessoais e conversas');
  perform pg_temp.ok((select count(*) from public.consent_events where client_id = c) >= 1,
    'histórico de consentimento é preservado após anonimizar');
  perform pg_temp.ok(exists (select 1 from public.audit_logs where action = 'lgpd.anonimizacao' and entity_id = c::text),
    'anonimização fica registrada na auditoria');
end $$;

reset role;
do $$ declare f int; t int; begin
  select count(*) filter (where not ok), count(*) into f, t from resultado;
  raise notice '======== % de % verificações passaram ========', t - f, t;
  if f > 0 then raise exception '% verificação(ões) falharam', f; end if;
end $$;
