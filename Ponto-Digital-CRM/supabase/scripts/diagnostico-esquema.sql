-- =============================================================================
-- DIAGNÓSTICO DO ESQUEMA — SOMENTE LEITURA (não altera nada).
-- Execute no SQL Editor do Supabase e copie o resultado para comparação.
-- =============================================================================

-- 1) Pré-requisitos da migração operacional
select 'organizations' as objeto, to_regclass('public.organizations') is not null as existe
union all select 'clients', to_regclass('public.clients') is not null
union all select 'profiles', to_regclass('public.profiles') is not null
union all select 'app.current_org()', to_regprocedure('app.current_org()') is not null
union all select 'app.has_role()', to_regprocedure('app.has_role(app.role[])') is not null
union all select 'clients UNIQUE (org_id, id)', exists (select 1 from pg_constraint where conrelid = to_regclass('public.clients') and pg_get_constraintdef(oid) = 'UNIQUE (org_id, id)')
union all select 'profiles UNIQUE (org_id, id)', exists (select 1 from pg_constraint where conrelid = to_regclass('public.profiles') and pg_get_constraintdef(oid) = 'UNIQUE (org_id, id)')
-- migrações anteriores (para saber quais já foram aplicadas)
union all select 'Fase 2: ai_suggestions', to_regclass('public.ai_suggestions') is not null
union all select 'Fase 2: wa_ingest_batch()', exists (select 1 from pg_proc where proname = 'wa_ingest_batch')
union all select 'Etapa 2: waweb_sessions', to_regclass('public.waweb_sessions') is not null;

-- 2) Tabelas que a migração CRIA: devem aparecer como "não existe" (se já existirem, são mantidas)
select t as tabela_nova, to_regclass('public.' || t) is not null as ja_existe
from unnest(array['media_assets', 'sales', 'payment_receipts', 'finance_entries', 'production_orders', 'guardian_events']) t;

-- 3) Todas as tabelas atuais do esquema public, com quantidade aproximada de linhas
select c.relname as tabela, c.reltuples::bigint as linhas_aprox, c.relrowsecurity as rls_ativa
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
