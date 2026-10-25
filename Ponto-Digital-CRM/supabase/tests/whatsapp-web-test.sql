-- =============================================================================
-- Teste da tabela da sessão do WhatsApp Web experimental (public.waweb_sessions).
-- Para um PostgreSQL LOCAL de testes (15+) — NÃO execute no projeto Supabase.
--
--   createdb pdcrm_waweb && psql -d pdcrm_waweb -f supabase/tests/whatsapp-web-test.sql
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
\i supabase/migrations/20261026000000_whatsapp_web_experimental.sql

create temp table resultado (ok boolean, item text);
grant all on resultado to public;
create function pg_temp.ok(b boolean, item text) returns void language plpgsql as $$
begin
  insert into resultado values (b, item);
  raise notice '%: %', case when b then 'OK   ' else 'FALHA' end, item;
end $$;

insert into public.organizations (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Org Teste');

-- Servidor (service_role) grava e lê a sessão
set role service_role;
insert into public.waweb_sessions (org_id, session_enc, phone) values ('00000000-0000-0000-0000-0000000000a1', 'v1.aaa.bbb.ccc', '5511977770001');
select pg_temp.ok((select count(*) from public.waweb_sessions) = 1, 'servidor grava e lê a sessão');
update public.waweb_sessions set session_enc = 'v1.ddd.eee.fff' where org_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.ok((select session_enc from public.waweb_sessions) = 'v1.ddd.eee.fff', 'servidor atualiza a sessão');
reset role;

-- Usuários do CRM e visitantes não têm acesso
do $$ declare denied boolean; begin
  set local role authenticated;
  begin perform 1 from public.waweb_sessions; denied := false; exception when insufficient_privilege then denied := true; end;
  reset role;
  perform pg_temp.ok(denied, 'usuário logado (authenticated) não lê a sessão');
  set local role authenticated;
  begin insert into public.waweb_sessions (org_id, session_enc) values ('00000000-0000-0000-0000-0000000000a1', 'v1.x.y.z'); denied := false; exception when insufficient_privilege then denied := true; end;
  reset role;
  perform pg_temp.ok(denied, 'usuário logado não grava sessão');
  set local role anon;
  begin perform 1 from public.waweb_sessions; denied := false; exception when insufficient_privilege then denied := true; end;
  reset role;
  perform pg_temp.ok(denied, 'visitante (anon) não lê a sessão');
end $$;

-- Só blocos criptografados e telefones válidos
do $$ declare rejected boolean; begin
  begin insert into public.waweb_sessions (org_id, session_enc) values ('00000000-0000-0000-0000-0000000000a1', '{"creds":{}}'); rejected := false;
  exception when check_violation then rejected := true; end;
  perform pg_temp.ok(rejected, 'sessão em texto aberto é recusada');
  begin update public.waweb_sessions set phone = 'abc'; rejected := false; exception when check_violation then rejected := true; end;
  perform pg_temp.ok(rejected, 'telefone inválido é recusado');
end $$;
do $$ declare rejected boolean; begin
  delete from public.waweb_sessions;
  begin insert into public.waweb_sessions (org_id, session_enc) values ('00000000-0000-0000-0000-0000000000a1', 'texto aberto'); rejected := false;
  exception when check_violation then rejected := true; end;
  perform pg_temp.ok(rejected, 'bloco sem o formato v1 é recusado (tabela vazia)');
end $$;

-- Excluir a organização apaga a sessão
insert into public.waweb_sessions (org_id, session_enc) values ('00000000-0000-0000-0000-0000000000a1', 'v1.a.b.c');
delete from public.organizations where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.ok((select count(*) from public.waweb_sessions) = 0, 'excluir a organização apaga a sessão');

do $$ declare t int; f int; begin
  select count(*), count(*) filter (where not ok) into t, f from resultado;
  raise notice '======== % de % verificações passaram ========', t - f, t;
  if f > 0 then raise exception '% verificação(ões) falharam', f; end if;
end $$;
