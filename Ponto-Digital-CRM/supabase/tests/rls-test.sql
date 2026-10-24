-- Teste de isolamento (RLS) para um PostgreSQL LOCAL de testes — não execute no projeto Supabase.
-- Simula o ambiente do Supabase (schema auth, roles) e testa o isolamento por RLS.
\set ON_ERROR_STOP on
create role authenticated nologin;
create role anon nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

\i supabase/migrations/20261024000000_inicial.sql  -- rode a partir da pasta do projeto

grant usage on schema public to authenticated;
create role service_like bypassrls nologin;
grant usage on schema public, app to service_like;
grant all on all tables in schema public to service_like;
grant select, insert, update, delete on all tables in schema public to authenticated;

insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000000a', 'Ponto Digital'), ('00000000-0000-0000-0000-00000000000b', 'Outra Agência');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'), ('00000000-0000-0000-0000-0000000000b1');
insert into public.profiles (id, org_id, name, email, role) values
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Admin A', 'a@a', 'admin'),
 ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'Atendente A', 'b@a', 'atendente'),
 ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Admin B', 'a@b', 'admin');
insert into public.clients (org_id, name, phone, consent_status) values
 ('00000000-0000-0000-0000-00000000000a', 'Cliente A1', '5511999990001', 'opt_in'),
 ('00000000-0000-0000-0000-00000000000a', 'Cliente A2', '5511999990002', 'desconhecido'),
 ('00000000-0000-0000-0000-00000000000b', 'Cliente B1', '5511999990003', 'opt_in');

-- deduplicação por nono dígito
do $$ begin
  insert into public.clients (org_id, name, phone) values ('00000000-0000-0000-0000-00000000000a', 'Dup', '551199990001');
  raise exception 'FALHA: duplicado aceito';
exception when unique_violation then raise notice 'OK: telefone duplicado (sem nono dígito) recusado';
end $$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$ begin
  if (select count(*) from public.clients) <> 2 then raise exception 'FALHA: atendente A vê clientes de outra organização'; end if;
  raise notice 'OK: atendente A vê apenas os 2 clientes da própria organização';
end $$;
do $$ begin
  insert into public.clients (org_id, name, phone) values ('00000000-0000-0000-0000-00000000000b', 'Invasão', '5511999990009');
  raise exception 'FALHA: inseriu em outra organização';
exception when insufficient_privilege then raise notice 'OK: inserção em outra organização bloqueada';
end $$;
do $$ declare n int; begin
  delete from public.clients; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: atendente excluiu clientes'; end if;
  raise notice 'OK: atendente não exclui clientes';
end $$;
do $$ begin
  if exists (select 1 from public.audit_logs) then raise exception 'FALHA'; end if;
  insert into public.audit_logs (org_id, user_id, action, entity) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'teste', 'x');
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'FALHA: atendente lê auditoria'; end if;
  raise notice 'OK: atendente registra mas não lê auditoria';
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  if (select count(*) from public.audit_logs) <> 1 then raise exception 'FALHA: admin não lê auditoria'; end if;
  raise notice 'OK: admin lê auditoria da organização';
end $$;
do $$ declare n int; begin
  update public.audit_logs set details = 'adulterado'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: auditoria alterada'; end if;
  delete from public.audit_logs; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: auditoria apagada'; end if;
  raise notice 'OK: auditoria não pode ser alterada nem apagada por usuários';
end $$;
do $$ declare c uuid; t uuid; k uuid; begin
  select id into c from public.clients where name = 'Cliente A2';
  insert into public.message_templates (org_id, name, category, body, status) values ('00000000-0000-0000-0000-00000000000a', 'promo', 'MARKETING', 'Oi', 'APPROVED') returning id into t;
  insert into public.campaigns (org_id, name, template_id) values ('00000000-0000-0000-0000-00000000000a', 'Camp', t) returning id into k;
  insert into public.campaign_recipients (campaign_id, org_id, client_id, status) values (k, '00000000-0000-0000-0000-00000000000a', c, 'simulada');
  raise exception 'FALHA: destinatário sem consentimento aceito';
exception when raise_exception then
  if sqlerrm like 'FALHA%' then raise; end if;
  raise notice 'OK: banco recusa destinatário de campanha sem opt-in';
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  if (select count(*) from public.clients) <> 1 or (select count(*) from public.audit_logs) <> 0 then raise exception 'FALHA: vazamento entre organizações'; end if;
  raise notice 'OK: admin da organização B não vê dados da organização A';
end $$;

reset role;
set role service_like;
do $$ begin
  update public.audit_logs set details = 'adulterado';
  raise exception 'FALHA: service role alterou auditoria';
exception when raise_exception then
  if sqlerrm like 'FALHA%' then raise; end if;
  raise notice 'OK: gatilho impede alteração da auditoria até pelo servidor (%).', sqlerrm;
end $$;
reset role;
set role anon;
do $$ begin
  perform 1 from public.clients;
  raise exception 'FALHA: anônimo leu clientes';
exception when insufficient_privilege then raise notice 'OK: acesso anônimo negado';
end $$;
