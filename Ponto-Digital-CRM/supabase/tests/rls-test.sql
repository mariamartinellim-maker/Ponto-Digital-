-- =============================================================================
-- Teste de segurança do esquema (RLS, chaves estrangeiras, auditoria, consentimento).
-- Para um PostgreSQL LOCAL de testes (15+) — NÃO execute no projeto Supabase.
--
--   createdb pdcrm_test && psql -d pdcrm_test -f supabase/tests/rls-test.sql
--   (rode a partir da pasta Ponto-Digital-CRM)
--
-- Simula o Supabase: schema auth, papéis anon/authenticated/service_role e os
-- privilégios padrão que o Supabase concede a toda tabela nova em "public".
-- Cada verificação imprime OK ou FALHA; o resumo final indica o total.
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

create temp table resultado (ok boolean, item text);
grant all on resultado to public;
create function pg_temp.ok(b boolean, item text) returns void language plpgsql as $$
begin
  insert into resultado values (b, item);
  raise notice '%: %', case when b then 'OK   ' else 'FALHA' end, item;
end $$;

-- ---------------------------------------------------------------------------
-- Dados: duas organizações (A e B)
-- ---------------------------------------------------------------------------
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@a.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'atendente@a.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'gestor@a.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'admin@b.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'sem-perfil@x.com');

-- 1. Criação da primeira organização e do administrador
do $$ declare org uuid; begin
  org := app.bootstrap_first_admin('admin@a.com', 'Ponto Digital', 'Admin A');
  perform pg_temp.ok(org is not null and (select role from public.profiles where id = '00000000-0000-0000-0000-0000000000a1') = 'admin',
    'bootstrap cria a primeira organização e o administrador');
  begin
    perform app.bootstrap_first_admin('admin@b.com', 'Intrusa', 'X');
    perform pg_temp.ok(false, 'bootstrap só funciona uma vez');
  exception when others then perform pg_temp.ok(true, 'bootstrap só funciona uma vez');
  end;
end $$;
do $$ declare can boolean; begin
  select has_function_privilege('authenticated', 'app.bootstrap_first_admin(text,text,text)', 'execute') into can;
  perform pg_temp.ok(not can, 'usuários da API não podem executar o bootstrap');
end $$;

-- Organização B criada pelo operador (fora do app)
insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000000b', 'Outra Agência');
insert into public.profiles (id, org_id, name, email, role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.com', 'admin');
do $$ declare a uuid; begin
  select org_id into a from public.profiles where id = '00000000-0000-0000-0000-0000000000a1';
  insert into public.profiles (id, org_id, name, email, role) values
    ('00000000-0000-0000-0000-0000000000a2', a, 'Atendente A', 'atendente@a.com', 'atendente'),
    ('00000000-0000-0000-0000-0000000000a3', a, 'Gestor A', 'gestor@a.com', 'gestor');
  insert into public.clients (id, org_id, name, phone) values
    ('00000000-0000-0000-0000-00000000c0a1', a, 'Cliente A1', '5511999990001'),
    ('00000000-0000-0000-0000-00000000c0a2', a, 'Cliente A2', '5511999990002');
  insert into public.clients (id, org_id, name, phone) values
    ('00000000-0000-0000-0000-00000000c0b1', '00000000-0000-0000-0000-00000000000b', 'Cliente B1', '5511999990003');
  insert into public.consent_events (org_id, client_id, status, source) values (a, '00000000-0000-0000-0000-00000000c0a1', 'opt_in', 'manual');
  insert into public.message_templates (id, org_id, name, category, body, status) values
    ('00000000-0000-0000-0000-0000000007a1', a, 'promo', 'MARKETING', 'Oi {{1}}. Responda SAIR para sair.', 'APPROVED');
  insert into public.message_templates (id, org_id, name, category, body, status) values
    ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-00000000000b', 'promo_b', 'MARKETING', 'Oi', 'APPROVED');
  insert into public.conversations (id, org_id, client_id, assignee_id) values
    ('00000000-0000-0000-0000-00000000cc01', a, '00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000a3');
  insert into public.conversations (id, org_id, client_id, assignee_id) values
    ('00000000-0000-0000-0000-00000000ccb1', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000c0b1', null);
end $$;

-- Sincronização do consentimento a partir do histórico
do $$ begin
  perform pg_temp.ok((select consent_status from public.clients where name = 'Cliente A1') = 'opt_in',
    'registrar consentimento atualiza o status do cliente');
end $$;

-- 2. Unicidade e deduplicação
do $$ begin
  insert into public.clients (org_id, name, phone) select org_id, 'Dup', '551199990001' from public.clients where name = 'Cliente A1';
  perform pg_temp.ok(false, 'telefone duplicado (sem nono dígito) é recusado');
exception when unique_violation then perform pg_temp.ok(true, 'telefone duplicado (sem nono dígito) é recusado');
end $$;

-- ===========================================================================
-- Como ATENDENTE da organização A
-- ===========================================================================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

do $$ begin
  perform pg_temp.ok((select count(*) from public.clients) = 2, 'atendente vê só os clientes da própria organização');
  perform pg_temp.ok((select count(*) from public.organizations) = 1, 'atendente vê só a própria organização');
  perform pg_temp.ok((select count(*) from public.conversations) = 0, 'atendente não vê conversa atribuída a outra pessoa');
  perform pg_temp.ok((select count(*) from public.audit_logs) = 0, 'atendente não lê auditoria');
end $$;

do $$ begin
  insert into public.clients (org_id, name, phone) values ('00000000-0000-0000-0000-00000000000b', 'Invasão', '5511999990009');
  perform pg_temp.ok(false, 'inserir cliente em outra organização é bloqueado');
exception when insufficient_privilege then perform pg_temp.ok(true, 'inserir cliente em outra organização é bloqueado');
end $$;

-- Chaves estrangeiras entre organizações
do $$ declare a uuid := app.current_org(); begin
  begin
    insert into public.deals (org_id, client_id, title) values (a, '00000000-0000-0000-0000-00000000c0b1', 'Sonda');
    perform pg_temp.ok(false, 'oportunidade não pode apontar para cliente de outra organização');
  exception when foreign_key_violation then perform pg_temp.ok(true, 'oportunidade não pode apontar para cliente de outra organização');
  end;
  begin
    insert into public.tasks (org_id, title, client_id, assignee_id, due_at) values (a, 'Sonda', '00000000-0000-0000-0000-00000000c0b1', auth.uid(), now());
    perform pg_temp.ok(false, 'tarefa não pode apontar para cliente de outra organização');
  exception when foreign_key_violation then perform pg_temp.ok(true, 'tarefa não pode apontar para cliente de outra organização');
  end;
  begin
    update public.clients set owner_id = '00000000-0000-0000-0000-0000000000b1' where name = 'Cliente A2';
    perform pg_temp.ok(false, 'responsável não pode ser usuário de outra organização');
  exception when foreign_key_violation then perform pg_temp.ok(true, 'responsável não pode ser usuário de outra organização');
  end;
  begin
    insert into public.messages (org_id, conversation_id, direction, origin, body, status, author_id)
      values (a, '00000000-0000-0000-0000-00000000ccb1', 'out', 'crm', 'x', 'simulada', auth.uid());
    perform pg_temp.ok(false, 'mensagem não pode ser gravada em conversa de outra organização');
  exception when foreign_key_violation or insufficient_privilege then perform pg_temp.ok(true, 'mensagem não pode ser gravada em conversa de outra organização');
  end;
end $$;

-- Consentimento: só pelo histórico (com autor verdadeiro)
do $$ declare n int; begin
  begin
    update public.clients set consent_status = 'opt_in' where name = 'Cliente A2';
    get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'consentimento não pode ser alterado direto no cadastro, sem registro');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'consentimento não pode ser alterado direto no cadastro, sem registro');
  end;
  begin
    insert into public.consent_events (org_id, client_id, status, source, by_user_id)
      values (app.current_org(), '00000000-0000-0000-0000-00000000c0a2', 'opt_in', 'manual', '00000000-0000-0000-0000-0000000000a1');
    perform pg_temp.ok(false, 'consentimento não pode ser registrado em nome de outra pessoa');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'consentimento não pode ser registrado em nome de outra pessoa');
  end;
  insert into public.consent_events (org_id, client_id, status, source, note, by_user_id)
    values (app.current_org(), '00000000-0000-0000-0000-00000000c0a2', 'opt_out', 'manual', 'Pediu para sair', auth.uid());
  perform pg_temp.ok((select consent_status from public.clients where name = 'Cliente A2') = 'opt_out', 'atendente registra descadastro pelo histórico');
  begin
    update public.consent_events set note = 'adulterado'; get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'histórico de consentimento não pode ser alterado');
  exception when insufficient_privilege or raise_exception then perform pg_temp.ok(true, 'histórico de consentimento não pode ser alterado');
  end;
  begin
    delete from public.consent_events; get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'histórico de consentimento não pode ser apagado');
  exception when insufficient_privilege or raise_exception then perform pg_temp.ok(true, 'histórico de consentimento não pode ser apagado');
  end;
end $$;

-- Auditoria: sem falsificação
do $$ declare n int; begin
  begin
    insert into public.audit_logs (org_id, user_id, action, entity) values (app.current_org(), '00000000-0000-0000-0000-0000000000a1', 'falso', 'x');
    perform pg_temp.ok(false, 'auditoria não aceita registro em nome de outro usuário');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'auditoria não aceita registro em nome de outro usuário');
  end;
  begin
    insert into public.audit_logs (org_id, user_id, action, entity, at) values (app.current_org(), auth.uid(), 'retroativo', 'x', '2000-01-01');
    perform pg_temp.ok(false, 'auditoria não aceita data/hora informada pelo usuário');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'auditoria não aceita data/hora informada pelo usuário');
  end;
  insert into public.audit_logs (org_id, user_id, action, entity) values (app.current_org(), auth.uid(), 'teste', 'x');
  perform pg_temp.ok(true, 'atendente registra auditoria da própria ação');
end $$;

-- Permissões por perfil
do $$ declare n int; begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid(); get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'atendente não se promove a administrador');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'atendente não se promove a administrador');
  end;
  begin
    delete from public.clients; get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'atendente não exclui clientes');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'atendente não exclui clientes');
  end;
  begin
    insert into public.message_templates (org_id, name, category, body) values (app.current_org(), 'x_y', 'UTILITY', 'Oi');
    perform pg_temp.ok(false, 'atendente não cria modelos');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'atendente não cria modelos');
  end;
  begin
    insert into public.tasks (org_id, title, assignee_id, due_at) values (app.current_org(), 'Para outro', '00000000-0000-0000-0000-0000000000a3', now());
    perform pg_temp.ok(false, 'atendente não cria tarefa para outra pessoa');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'atendente não cria tarefa para outra pessoa');
  end;
end $$;

-- ===========================================================================
-- Como GESTOR da organização A
-- ===========================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
do $$ declare n int; c uuid; begin
  begin
    insert into public.message_templates (org_id, name, category, body, status) values (app.current_org(), 'auto_aprovado', 'MARKETING', 'Oi', 'APPROVED');
    perform pg_temp.ok(false, 'gestor não aprova modelo sozinho (status vem da Meta)');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'gestor não aprova modelo sozinho (status vem da Meta)');
  end;
  insert into public.message_templates (org_id, name, category, body) values (app.current_org(), 'novo_modelo', 'UTILITY', 'Olá {{1}}');
  perform pg_temp.ok((select status from public.message_templates where name = 'novo_modelo') = 'PENDING', 'gestor cria modelo como pendente');
  begin
    insert into public.campaigns (org_id, name, template_id, mode) values (app.current_org(), 'Live', '00000000-0000-0000-0000-0000000007a1', 'live');
    perform pg_temp.ok(false, 'gestor não cria campanha em modo de envio real');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'gestor não cria campanha em modo de envio real');
  end;
  begin
    insert into public.campaigns (org_id, name, template_id) values (app.current_org(), 'Cruzada', '00000000-0000-0000-0000-0000000007b1');
    perform pg_temp.ok(false, 'campanha não usa modelo de outra organização');
  exception when foreign_key_violation then perform pg_temp.ok(true, 'campanha não usa modelo de outra organização');
  end;
  insert into public.campaigns (org_id, name, template_id) values (app.current_org(), 'Camp', '00000000-0000-0000-0000-0000000007a1') returning id into c;
  begin
    insert into public.campaign_recipients (campaign_id, org_id, client_id, status) values (c, app.current_org(), '00000000-0000-0000-0000-00000000c0a2', 'simulada');
    perform pg_temp.ok(false, 'campanha recusa destinatário sem opt-in');
  exception when check_violation then perform pg_temp.ok(true, 'campanha recusa destinatário sem opt-in');
  end;
  insert into public.campaign_recipients (campaign_id, org_id, client_id, status) values (c, app.current_org(), '00000000-0000-0000-0000-00000000c0a1', 'simulada');
  perform pg_temp.ok(true, 'campanha aceita destinatário com opt-in');
  perform pg_temp.ok((select count(*) from public.conversations) = 1, 'gestor vê todas as conversas da organização');
  begin
    delete from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'; get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'gestor não remove usuários');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'gestor não remove usuários');
  end;
end $$;

-- ===========================================================================
-- Como ADMIN da organização A
-- ===========================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ declare n int; begin
  perform pg_temp.ok((select count(*) from public.audit_logs) >= 1, 'admin lê a auditoria da organização');
  begin
    update public.audit_logs set details = 'adulterado'; get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'admin não altera a auditoria');
  exception when insufficient_privilege or raise_exception then perform pg_temp.ok(true, 'admin não altera a auditoria');
  end;
  begin
    delete from public.audit_logs; get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'admin não apaga a auditoria');
  exception when insufficient_privilege or raise_exception then perform pg_temp.ok(true, 'admin não apaga a auditoria');
  end;
  begin
    update public.profiles set role = 'atendente' where id = auth.uid();
    perform pg_temp.ok(false, 'último administrador não pode ser rebaixado');
  exception when raise_exception then perform pg_temp.ok(true, 'último administrador não pode ser rebaixado');
  end;
  begin
    update public.profiles set org_id = '00000000-0000-0000-0000-00000000000b' where id = '00000000-0000-0000-0000-0000000000a2';
    perform pg_temp.ok(false, 'admin não move usuário para outra organização');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'admin não move usuário para outra organização');
  end;
  begin
    update public.organizations set wa_phone_number_id = '123';
    perform pg_temp.ok(false, 'admin não troca o número de WhatsApp vinculado (só o servidor)');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'admin não troca o número de WhatsApp vinculado (só o servidor)');
  end;
  update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a3';
  update public.profiles set role = 'atendente' where id = '00000000-0000-0000-0000-0000000000a3';
  perform pg_temp.ok(true, 'admin altera perfis da equipe');
  -- LGPD: anonimização pelo admin (sem apagar o histórico de consentimento)
  update public.clients set name = 'Titular anonimizado', email = '', notes = '', city = '' where name = 'Cliente A2';
  perform pg_temp.ok((select count(*) from public.consent_events where client_id = '00000000-0000-0000-0000-00000000c0a2') = 1,
    'anonimização preserva o histórico de consentimento');
end $$;

-- ===========================================================================
-- Como ADMIN da organização B / usuário sem perfil / anônimo
-- ===========================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  perform pg_temp.ok((select count(*) from public.clients) = 1 and (select count(*) from public.audit_logs) = 0
    and (select count(*) from public.consent_events) = 0 and (select count(*) from public.campaigns) = 0,
    'admin da organização B não vê nada da organização A');
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin
  perform pg_temp.ok((select count(*) from public.clients) = 0 and (select count(*) from public.profiles) = 0,
    'usuário autenticado sem perfil (ex.: cadastro público) não vê nada');
  begin
    insert into public.profiles (id, org_id, name, email, role) values (auth.uid(), '00000000-0000-0000-0000-00000000000b', 'Eu', 'x@x', 'admin');
    perform pg_temp.ok(false, 'usuário sem perfil não se adiciona a uma organização');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'usuário sem perfil não se adiciona a uma organização');
  end;
end $$;

reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.clients;
    perform pg_temp.ok(false, 'acesso anônimo negado');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'acesso anônimo negado');
  end;
end $$;

-- ===========================================================================
-- Servidor (service_role): auditoria continua somente-inclusão
-- ===========================================================================
reset role;
set role service_role;
do $$ begin
  begin
    update public.audit_logs set details = 'adulterado';
    perform pg_temp.ok(false, 'nem o servidor altera a auditoria');
  exception when raise_exception or insufficient_privilege then perform pg_temp.ok(true, 'nem o servidor altera a auditoria');
  end;
  begin
    delete from public.consent_events;
    perform pg_temp.ok(false, 'nem o servidor apaga o histórico de consentimento');
  exception when raise_exception or insufficient_privilege then perform pg_temp.ok(true, 'nem o servidor apaga o histórico de consentimento');
  end;
end $$;
-- ===========================================================================
-- Operações normais do CRM continuam funcionando
-- ===========================================================================
reset role;
insert into auth.users values ('00000000-0000-0000-0000-0000000000a4', 'novo@a.com');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ declare a uuid := app.current_org(); begin
  insert into public.profiles (id, org_id, name, email, role) values ('00000000-0000-0000-0000-0000000000a4', a, 'Nova Pessoa', 'novo@a.com', 'atendente');
  perform pg_temp.ok(true, 'admin adiciona pessoa à equipe');
  insert into public.clients (org_id, name, phone, city, services) values (a, 'Cliente Novo', '5519988887777', 'Campinas', '{SEO}');
  insert into public.deals (org_id, client_id, title, value_cents) select a, id, 'Pacote', 150000 from public.clients where name = 'Cliente Novo';
  update public.deals set stage = 'fechado', closed_at = now() where title = 'Pacote';
  perform pg_temp.ok((select stage from public.deals where title = 'Pacote') = 'fechado', 'cadastro de cliente e funil funcionam');
  insert into public.tasks (org_id, title, assignee_id, due_at) values (a, 'Retorno', '00000000-0000-0000-0000-0000000000a2', now() + interval '1 day');
  perform pg_temp.ok(true, 'admin agenda tarefa para a equipe');
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';  -- gestor (responsável pela conversa)
do $$ declare a uuid := app.current_org(); c uuid; begin
  insert into public.messages (org_id, conversation_id, direction, origin, body, status, author_id)
    values (a, '00000000-0000-0000-0000-00000000cc01', 'out', 'crm', 'Olá!', 'simulada', auth.uid());
  perform pg_temp.ok((select last_message_at > now() - interval '1 minute' from public.conversations where id = '00000000-0000-0000-0000-00000000cc01'),
    'mensagem enviada atualiza a conversa');
  begin
    insert into public.messages (org_id, conversation_id, direction, origin, body, status, author_id)
      values (a, '00000000-0000-0000-0000-00000000cc01', 'in', 'cliente', 'falsa', 'recebida', null);
    perform pg_temp.ok(false, 'usuário não forja mensagem "recebida do cliente"');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'usuário não forja mensagem "recebida do cliente"');
  end;
  update public.conversations set status = 'resolvida', unread = 0 where id = '00000000-0000-0000-0000-00000000cc01';
  select id into c from public.campaigns where name = 'Camp';
  update public.campaigns set status = 'concluida', executed_at = now() where id = c;
  perform pg_temp.ok(true, 'gestor resolve conversa e conclui campanha (simulação)');
end $$;

reset role;
set role service_role;   -- servidor: webhooks da Meta
do $$ declare a uuid; begin
  select org_id into a from public.profiles where id = '00000000-0000-0000-0000-0000000000a1';
  insert into public.messages (org_id, conversation_id, direction, origin, body, status, wa_message_id)
    values (a, '00000000-0000-0000-0000-00000000cc01', 'in', 'cliente', 'Oi!', 'recebida', 'wamid.1');
  perform pg_temp.ok((select unread = 1 and status = 'aberta' and last_inbound_at is not null from public.conversations where id = '00000000-0000-0000-0000-00000000cc01'),
    'webhook: mensagem recebida reabre a conversa e abre a janela de 24h');
  begin
    insert into public.messages (org_id, conversation_id, direction, origin, body, status, wa_message_id)
      values (a, '00000000-0000-0000-0000-00000000cc01', 'in', 'cliente', 'Oi!', 'recebida', 'wamid.1');
    perform pg_temp.ok(false, 'webhook repetido é ignorado (idempotência)');
  exception when unique_violation then perform pg_temp.ok(true, 'webhook repetido é ignorado (idempotência)');
  end;
  update public.campaign_recipients set status = 'lida', wa_message_id = 'wamid.c1';
  update public.message_templates set status = 'APPROVED', meta_template_id = 'm1' where name = 'novo_modelo';
  insert into public.consent_events (org_id, client_id, status, source, note)
    select org_id, id, 'opt_out', 'palavra_chave', 'Cliente enviou SAIR' from public.clients where name = 'Cliente A1';
  insert into public.audit_logs (org_id, user_id, action, entity, ip) values (a, null, 'webhook', 'x', '203.0.113.5');
  perform pg_temp.ok((select consent_status from public.clients where name = 'Cliente A1') = 'opt_out',
    'servidor atualiza status, aprova modelo pela Meta e registra descadastro por SAIR');
end $$;

-- Dono do banco: excluir uma organização inteira remove tudo dela (inclusive histórico)
reset role;
do $$ declare b uuid := '00000000-0000-0000-0000-00000000000b'; n int; begin
  delete from public.profiles where org_id = b;
  delete from public.organizations where id = b;
  select count(*) into n from public.clients where org_id = b;
  perform pg_temp.ok(n = 0 and (select count(*) from public.clients) > 0, 'exclusão de organização inteira (pelo dono do banco) funciona sem afetar as outras');
end $$;

reset role;

do $$ declare f int; t int; begin
  select count(*) filter (where not ok), count(*) into f, t from resultado;
  raise notice '======== % de % verificações passaram ========', t - f, t;
  if f > 0 then raise exception '% verificação(ões) falharam', f; end if;
end $$;
