-- =============================================================================
-- Teste das tabelas operacionais (biblioteca, vendas, comprovantes, financeiro,
-- produção e Guardian): isolamento por organização e permissões por perfil.
-- Para um PostgreSQL LOCAL de testes (15+) — NÃO execute no projeto Supabase.
--
--   createdb pdcrm_operacao && psql -d pdcrm_operacao -f supabase/tests/operacao-test.sql
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
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

\i supabase/migrations/20261024000000_inicial.sql
\i supabase/migrations/20261025000000_fase2_whatsapp_ia.sql
\i supabase/migrations/20261026000000_whatsapp_web_experimental.sql
\i supabase/migrations/20261026010000_operacao_vendas_producao.sql

create temp table resultado (ok boolean, item text);
grant all on resultado to public;
create function pg_temp.ok(b boolean, item text) returns void language plpgsql as $$
begin
  insert into resultado values (b, item);
  raise notice '%: %', case when b then 'OK   ' else 'FALHA' end, item;
end $$;

-- Organização A (admin a1, atendente a2, gestor a4) e organização B (admin b1)
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000000a', 'Org A'), ('00000000-0000-0000-0000-00000000000b', 'Org B');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@a.com'), ('00000000-0000-0000-0000-0000000000a2', 'atend@a.com'),
  ('00000000-0000-0000-0000-0000000000a4', 'gestor@a.com'), ('00000000-0000-0000-0000-0000000000b1', 'admin@b.com');
insert into public.profiles (id, org_id, name, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.com', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'Atendente A', 'atend@a.com', 'atendente'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000000a', 'Gestor A', 'gestor@a.com', 'gestor'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.com', 'admin');
insert into public.clients (id, org_id, name, phone) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Cliente A', '5511966660001'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000b', 'Cliente B', '5511966660002');

-- Helper: executa um comando como usuário e diz se foi recusado
create function pg_temp.recusado(uid text, cmd text) returns boolean language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
  begin
    execute cmd;
    get diagnostics n = row_count;
    execute 'reset role';
    return n = 0;
  exception when insufficient_privilege or check_violation or foreign_key_violation or unique_violation then
    execute 'reset role';
    return true;
  end;
end $$;
create function pg_temp.conta(uid text, q text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
  execute q into n;
  execute 'reset role';
  return n;
end $$;

\o /dev/null
\set A1 '''00000000-0000-0000-0000-0000000000a1'''
\set A2 '''00000000-0000-0000-0000-0000000000a2'''
\set A4 '''00000000-0000-0000-0000-0000000000a4'''
\set B1 '''00000000-0000-0000-0000-0000000000b1'''

-- ---------------------------------------------------------------------------
-- Biblioteca de mídias
-- ---------------------------------------------------------------------------
begin;
select pg_temp.ok(not pg_temp.recusado(:A4, $q$insert into public.media_assets (id, org_id, title, type, mime, size, filename, storage_key, created_by)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', 'Comprovante', 'image', 'image/png', 100, 'c.png', 'a/d1/c.png', '00000000-0000-0000-0000-0000000000a4')$q$),
  'gestor envia mídia para a biblioteca');
select pg_temp.ok(pg_temp.recusado(:A2, $q$insert into public.media_assets (org_id, title, type, mime, size, filename, storage_key, created_by)
  values ('00000000-0000-0000-0000-00000000000a', 'X', 'image', 'image/png', 100, 'x.png', 'a/x/x.png', '00000000-0000-0000-0000-0000000000a2')$q$),
  'atendente não envia mídia');
select pg_temp.ok(pg_temp.conta(:A2, 'select count(*) from public.media_assets') = 1, 'atendente vê a biblioteca da organização');
select pg_temp.ok(pg_temp.conta(:B1, 'select count(*) from public.media_assets') = 0, 'outra organização não vê a biblioteca');
select pg_temp.ok(pg_temp.recusado(:A2, 'delete from public.media_assets'), 'atendente não apaga mídia');
select pg_temp.ok(pg_temp.recusado(:A4, $q$insert into public.media_assets (org_id, title, type, mime, size, filename, storage_key, created_by)
  values ('00000000-0000-0000-0000-00000000000a', 'Grande', 'video', 'video/mp4', 99999999999, 'g.mp4', 'a/g/g.mp4', '00000000-0000-0000-0000-0000000000a4')$q$),
  'arquivo acima de 50 MB é recusado');
commit;

-- ---------------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------------
begin;
select pg_temp.ok(not pg_temp.recusado(:A2, $q$insert into public.sales (id, org_id, number, client_id, items, total_cents, created_by)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a', 1, '00000000-0000-0000-0000-0000000000c1',
  '[{"description":"Logo","quantity":1,"unitCents":50000}]', 50000, '00000000-0000-0000-0000-0000000000a2')$q$),
  'atendente registra venda aguardando pagamento');
select pg_temp.ok(pg_temp.recusado(:A2, $q$insert into public.sales (org_id, number, client_id, items, total_cents, status, paid_at, created_by)
  values ('00000000-0000-0000-0000-00000000000a', 2, '00000000-0000-0000-0000-0000000000c1', '[{"d":1}]', 100, 'pago', now(), '00000000-0000-0000-0000-0000000000a2')$q$),
  'ninguém cria venda já paga');
select pg_temp.ok(pg_temp.recusado(:A2, $q$update public.sales set status = 'pago', paid_at = now()$q$), 'atendente não dá baixa em venda');
select pg_temp.ok(pg_temp.recusado(:A2, $q$insert into public.sales (org_id, number, client_id, items, total_cents, created_by)
  values ('00000000-0000-0000-0000-00000000000a', 1, '00000000-0000-0000-0000-0000000000c1', '[{"d":1}]', 100, '00000000-0000-0000-0000-0000000000a2')$q$),
  'número de venda repetido na organização é recusado');
select pg_temp.ok(pg_temp.recusado(:A2, $q$insert into public.sales (org_id, number, client_id, items, total_cents, created_by)
  values ('00000000-0000-0000-0000-00000000000a', 3, '00000000-0000-0000-0000-0000000000c2', '[{"d":1}]', 100, '00000000-0000-0000-0000-0000000000a2')$q$),
  'venda para cliente de outra organização é recusada');
select pg_temp.ok(pg_temp.conta(:B1, 'select count(*) from public.sales') = 0, 'outra organização não vê as vendas');
select pg_temp.ok(pg_temp.recusado(:A2, $q$update public.sales set total_cents = 1$q$), 'valor da venda não pode ser alterado depois');
commit;

-- ---------------------------------------------------------------------------
-- Comprovantes e financeiro
-- ---------------------------------------------------------------------------
begin;
select pg_temp.ok(not pg_temp.recusado(:A4, $q$insert into public.payment_receipts (id, org_id, media_id, client_id, created_by, data, analyzer)
  values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a4', '{"valorCentavos":50000}', 'simulador')$q$),
  'gestor registra comprovante');
select pg_temp.ok(pg_temp.conta(:A2, 'select count(*) from public.payment_receipts') = 0, 'atendente não vê comprovantes');
select pg_temp.ok(pg_temp.recusado(:A4, $q$insert into public.payment_receipts (org_id, media_id, created_by, status)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a4', 'pendente')$q$),
  'o mesmo arquivo não vira dois comprovantes');
select pg_temp.ok(pg_temp.recusado(:A4, $q$update public.payment_receipts set status = 'confirmado', reviewed_by = '00000000-0000-0000-0000-0000000000a4', reviewed_at = now()$q$),
  'comprovante só é confirmado com venda vinculada');
select pg_temp.ok(not pg_temp.recusado(:A4, $q$update public.payment_receipts set status = 'confirmado', sale_id = '00000000-0000-0000-0000-0000000000e1',
  reviewed_by = '00000000-0000-0000-0000-0000000000a4', reviewed_at = now()$q$), 'gestor confirma comprovante vinculado à venda');
select pg_temp.ok(pg_temp.recusado(:A4, $q$update public.payment_receipts set status = 'rejeitado'$q$), 'comprovante confirmado não volta atrás');
select pg_temp.ok(not pg_temp.recusado(:A4, $q$update public.sales set status = 'pago', paid_at = now(), receipt_id = '00000000-0000-0000-0000-0000000000f1'$q$),
  'gestor dá baixa na venda');
select pg_temp.ok(not pg_temp.recusado(:A4, $q$insert into public.finance_entries (org_id, kind, category, description, amount_cents, date, sale_id, created_by)
  values ('00000000-0000-0000-0000-00000000000a', 'entrada', 'Vendas', 'Venda #1', 50000, current_date, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a4')$q$),
  'gestor lança a entrada no financeiro');
select pg_temp.ok(pg_temp.recusado(:A2, $q$insert into public.finance_entries (org_id, kind, category, description, amount_cents, date, created_by)
  values ('00000000-0000-0000-0000-00000000000a', 'entrada', 'Vendas', 'forjado', 100, current_date, '00000000-0000-0000-0000-0000000000a2')$q$),
  'atendente não lança no financeiro');
select pg_temp.ok(pg_temp.recusado(:A1, $q$update public.finance_entries set amount_cents = 1$q$), 'lançamento não é editado (nem pelo admin)');
select pg_temp.ok(pg_temp.recusado(:A1, $q$delete from public.finance_entries$q$), 'lançamento não é apagado');
select pg_temp.ok(pg_temp.conta(:B1, 'select count(*) from public.finance_entries') = 0, 'outra organização não vê o financeiro');
select pg_temp.ok(pg_temp.recusado(:A2, $q$update public.sales set status = 'cancelada'$q$), 'atendente não cancela venda já paga');
commit;

-- ---------------------------------------------------------------------------
-- Produção
-- ---------------------------------------------------------------------------
begin;
select pg_temp.ok(not pg_temp.recusado(:A4, $q$insert into public.production_orders (id, org_id, number, sale_id, client_id, title, checklist)
  values ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000000a', 1, '00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-0000000000c1', 'Logo — Cliente A', '[{"label":"Briefing","done":false}]')$q$),
  'ordem de produção criada a partir da venda');
select pg_temp.ok(pg_temp.recusado(:A4, $q$insert into public.production_orders (org_id, number, sale_id, client_id, title)
  values ('00000000-0000-0000-0000-00000000000a', 2, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'Duplicada')$q$),
  'uma venda gera uma única ordem de produção');
select pg_temp.ok(pg_temp.recusado(:A2, $q$insert into public.production_orders (org_id, number, client_id, title, stage)
  values ('00000000-0000-0000-0000-00000000000a', 3, '00000000-0000-0000-0000-0000000000c1', 'Pulando etapas', 'entregue')$q$),
  'ordem nova não nasce entregue');
select pg_temp.ok(not pg_temp.recusado(:A2, $q$insert into public.production_orders (org_id, number, client_id, title)
  values ('00000000-0000-0000-0000-00000000000a', 4, '00000000-0000-0000-0000-0000000000c1', 'Ordem avulsa')$q$),
  'atendente abre ordem avulsa na fila');
select pg_temp.ok(not pg_temp.recusado(:A2, $q$update public.production_orders set stage = 'producao', assignee_id = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-0000000000a9'$q$),
  'atendente move a ordem e assume a produção');
select pg_temp.ok(pg_temp.recusado(:A2, $q$update public.production_orders set stage = 'cancelada' where id = '00000000-0000-0000-0000-0000000000a9'$q$), 'atendente não cancela ordem');
select pg_temp.ok(pg_temp.recusado(:A2, $q$update public.production_orders set assignee_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000a9'$q$),
  'responsável de outra organização é recusado');
select pg_temp.ok(not pg_temp.recusado(:A4, $q$update public.production_orders set stage = 'entregue', delivered_at = now() where id = '00000000-0000-0000-0000-0000000000a9'$q$), 'gestor marca como entregue');
select pg_temp.ok(pg_temp.recusado(:A1, $q$update public.production_orders set stage = 'producao' where id = '00000000-0000-0000-0000-0000000000a9'$q$), 'ordem entregue fica travada');
select pg_temp.ok(pg_temp.conta(:B1, 'select count(*) from public.production_orders') = 0, 'outra organização não vê a produção');
commit;

-- ---------------------------------------------------------------------------
-- Guardian
-- ---------------------------------------------------------------------------
set role service_role;
insert into public.guardian_events (org_id, level, source, message) values ('00000000-0000-0000-0000-00000000000a', 'aviso', 'waweb', 'Conexão caiu');
insert into public.guardian_events (org_id, level, source, message) values (null, 'info', 'sistema', 'Servidor iniciado');
reset role;
begin;
select pg_temp.ok(pg_temp.conta(:A1, 'select count(*) from public.guardian_events') = 2, 'admin vê os eventos do Guardian');
select pg_temp.ok(pg_temp.conta(:A4, 'select count(*) from public.guardian_events') = 0, 'gestor não vê os eventos do Guardian');
select pg_temp.ok(pg_temp.conta(:B1, 'select count(*) from public.guardian_events') = 1, 'outra organização vê só eventos gerais');
select pg_temp.ok(pg_temp.recusado(:A1, $q$insert into public.guardian_events (level, source, message) values ('info', 'x', 'forjado')$q$), 'usuário não grava eventos');
commit;

do $$ declare rejected boolean; begin
  set local role anon;
  begin perform 1 from public.sales; rejected := false; exception when insufficient_privilege then rejected := true; end;
  reset role;
  perform pg_temp.ok(rejected, 'visitante (anon) não acessa vendas');
end $$;

do $$ declare t int; f int; begin
  select count(*), count(*) filter (where not ok) into t, f from resultado;
  raise notice '======== % de % verificações passaram ========', t - f, t;
  if f > 0 then raise exception '% verificação(ões) falharam', f; end if;
end $$;
