-- =============================================================================
-- Banco LOCAL que imita o Supabase para testes via PostgREST (a mesma API que o
-- supabase-js usa). NÃO execute no projeto Supabase. Usado por scripts/testes/supabase-rest.sh.
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit password 'senha-local-de-teste'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema auth;
create table auth.users (id uuid primary key, email text unique);
-- PostgREST 12 publica as declarações do token em request.jwt.claims (JSON).
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', current_setting('request.jwt.claim.sub', true)), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

\i supabase/migrations/20261024000000_inicial.sql
\i supabase/migrations/20261025000000_fase2_whatsapp_ia.sql
\i supabase/migrations/20261026000000_whatsapp_web_experimental.sql
\i supabase/migrations/20261026010000_operacao_vendas_producao.sql

-- Dados de teste: organização A (admin, gestor, atendente) e organização B (admin)
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000000a', 'Ponto Digital (teste)'), ('00000000-0000-0000-0000-00000000000b', 'Outra empresa');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@a.test'), ('00000000-0000-0000-0000-0000000000a2', 'atendente@a.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'gestor@a.test'), ('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');
insert into public.profiles (id, org_id, name, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'Atendente A', 'atendente@a.test', 'atendente'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000000a', 'Gestor A', 'gestor@a.test', 'gestor'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test', 'admin');
insert into public.clients (id, org_id, name, phone) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Cliente A', '5511966660001'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000b', 'Cliente B', '5511966660002');
