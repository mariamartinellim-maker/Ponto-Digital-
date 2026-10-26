-- =============================================================================
-- Módulos operacionais (biblioteca, vendas, comprovantes, financeiro, produção, Guardian)
-- VERSÃO SEGURA E IDEMPOTENTE da migração 20261026010000_operacao_vendas_producao.sql.
--
--  * Só CRIA objetos novos: 6 tabelas, seus índices e políticas de acesso (RLS).
--  * NÃO altera, renomeia ou apaga nenhuma tabela, coluna ou dado existente.
--  * Pode ser executada mais de uma vez: o que já existe é mantido como está.
--  * Tudo numa transação: se qualquer verificação falhar, nada é gravado.
--
-- Antes: rode supabase/scripts/diagnostico-esquema.sql (somente leitura) e confira o resultado.
-- Execute no SQL Editor do Supabase do projeto de TESTE, somente após aprovação.
-- =============================================================================
begin;

-- Pré-requisitos (criados pela migração inicial). Sem eles, aborta sem alterar nada.
do $check$
declare missing text[] := '{}';
begin
  if to_regclass('public.organizations') is null then missing := array_append(missing, 'tabela organizations'); end if;
  if to_regclass('public.clients') is null then missing := array_append(missing, 'tabela clients'); end if;
  if to_regclass('public.profiles') is null then missing := array_append(missing, 'tabela profiles'); end if;
  if to_regprocedure('app.current_org()') is null then missing := array_append(missing, 'função app.current_org()'); end if;
  if to_regprocedure('app.has_role(app.role[])') is null then missing := array_append(missing, 'função app.has_role()'); end if;
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('public.clients') and contype = 'u'
                 and pg_get_constraintdef(oid) = 'UNIQUE (org_id, id)') then missing := array_append(missing, 'chave única clients(org_id, id)'); end if;
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('public.profiles') and contype = 'u'
                 and pg_get_constraintdef(oid) = 'UNIQUE (org_id, id)') then missing := array_append(missing, 'chave única profiles(org_id, id)'); end if;
  if cardinality(missing) > 0 then
    raise exception 'Pré-requisitos ausentes: %. Nada foi alterado.', array_to_string(missing, ', ');
  end if;
end $check$;

-- ---------------------------------------------------------------------------
-- Biblioteca de mídias (arquivo no Supabase Storage, bucket privado "crm-arquivos")
-- ---------------------------------------------------------------------------
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (length(title) between 1 and 160),
  type text not null check (type in ('image', 'audio', 'video', 'document')),
  mime text not null check (length(mime) <= 100),
  size bigint not null check (size > 0 and size <= 52428800),
  filename text not null check (length(filename) between 1 and 200),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  source text not null default 'upload' check (source in ('upload', 'whatsapp_web', 'whatsapp')),
  client_id uuid,
  storage_key text not null unique check (length(storage_key) <= 400),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete set null (client_id)
);
create index if not exists media_assets_org_id_created_at_idx on public.media_assets (org_id, created_at desc);
alter table public.media_assets enable row level security;
revoke all on public.media_assets from public, anon, authenticated;
grant select, delete on public.media_assets to authenticated;
grant insert (id, org_id, title, type, mime, size, filename, tags, source, client_id, storage_key, created_by, created_at) on public.media_assets to authenticated;
grant update (title, tags, client_id) on public.media_assets to authenticated;
grant select, insert, update, delete on public.media_assets to service_role;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'media_assets' and policyname = 'media_select') then
    execute $p$create policy media_select on public.media_assets for select to authenticated using (org_id = app.current_org())$p$;
  end if;
end $do$;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'media_assets' and policyname = 'media_insert') then
    execute $p$create policy media_insert on public.media_assets for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor') and created_by = auth.uid())$p$;
  end if;
end $do$;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'media_assets' and policyname = 'media_update') then
    execute $p$create policy media_update on public.media_assets for update to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor')) with check (org_id = app.current_org())$p$;
  end if;
end $do$;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'media_assets' and policyname = 'media_delete') then
    execute $p$create policy media_delete on public.media_assets for delete to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor'))$p$;
  end if;
end $do$;

-- ---------------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------------
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number integer not null check (number > 0),
  client_id uuid not null,
  deal_id uuid,
  conversation_id uuid,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  total_cents bigint not null check (total_cents > 0),
  status text not null default 'aguardando_pagamento' check (status in ('aguardando_pagamento', 'pago', 'cancelada')),
  payment_method text not null default 'pix' check (payment_method in ('pix', 'boleto', 'ted', 'cartao', 'dinheiro', 'outro')),
  due_date date,
  paid_at timestamptz,
  receipt_id uuid,
  notes text not null default '' check (length(notes) <= 2000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number),
  unique (org_id, id),
  check ((status = 'pago') = (paid_at is not null) or status = 'cancelada'),
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete restrict
);
create index if not exists sales_org_id_status_created_at_idx on public.sales (org_id, status, created_at desc);
alter table public.sales enable row level security;
revoke all on public.sales from public, anon, authenticated;
grant select on public.sales to authenticated;
grant insert (id, org_id, number, client_id, deal_id, conversation_id, items, total_cents, status, payment_method, due_date, paid_at, receipt_id, notes, created_by, created_at, updated_at) on public.sales to authenticated;
grant update (status, paid_at, receipt_id, notes, updated_at) on public.sales to authenticated;
grant select, insert, update, delete on public.sales to service_role;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales' and policyname = 'sales_select') then
    execute $p$create policy sales_select on public.sales for select to authenticated using (org_id = app.current_org())$p$;
  end if;
end $do$;
-- Toda venda nasce aguardando pagamento: só o financeiro (admin/gestor) dá baixa.
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales' and policyname = 'sales_insert') then
    execute $p$create policy sales_insert on public.sales for insert to authenticated
  with check (org_id = app.current_org() and status = 'aguardando_pagamento' and paid_at is null and created_by = auth.uid())$p$;
  end if;
end $do$;
-- Atendente: só mexe em vendas em aberto e nunca as marca como pagas.
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales' and policyname = 'sales_update') then
    execute $p$create policy sales_update on public.sales for update to authenticated
  using (org_id = app.current_org() and (app.has_role('admin', 'gestor') or status = 'aguardando_pagamento'))
  with check (org_id = app.current_org() and (app.has_role('admin', 'gestor') or status <> 'pago'))$p$;
  end if;
end $do$;

-- ---------------------------------------------------------------------------
-- Comprovantes de pagamento
-- ---------------------------------------------------------------------------
create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  media_id uuid not null,
  client_id uuid,
  sale_id uuid,
  status text not null default 'pendente' check (status in ('pendente', 'confirmado', 'rejeitado', 'duplicado')),
  data jsonb check (data is null or jsonb_typeof(data) = 'object'),
  analyzer text not null default 'pendente' check (analyzer in ('ia', 'simulador', 'manual', 'pendente')),
  analysis_error text check (analysis_error is null or length(analysis_error) <= 300),
  duplicate_of uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, media_id),
  foreign key (org_id, media_id) references public.media_assets (org_id, id) on delete restrict,
  foreign key (org_id, sale_id) references public.sales (org_id, id) on delete set null (sale_id),
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete set null (client_id),
  check (status <> 'confirmado' or (sale_id is not null and reviewed_by is not null))
);
create index if not exists payment_receipts_org_id_status_created_at_idx on public.payment_receipts (org_id, status, created_at desc);
alter table public.payment_receipts enable row level security;
revoke all on public.payment_receipts from public, anon, authenticated;
grant select on public.payment_receipts to authenticated;
grant insert (id, org_id, media_id, client_id, sale_id, status, data, analyzer, analysis_error, duplicate_of, reviewed_by, reviewed_at, created_by, created_at) on public.payment_receipts to authenticated;
grant update (client_id, sale_id, status, data, analyzer, analysis_error, duplicate_of, reviewed_by, reviewed_at) on public.payment_receipts to authenticated;
grant select, insert, update, delete on public.payment_receipts to service_role;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_receipts' and policyname = 'receipts_select') then
    execute $p$create policy receipts_select on public.payment_receipts for select to authenticated using (org_id = app.current_org() and app.has_role('admin', 'gestor'))$p$;
  end if;
end $do$;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_receipts' and policyname = 'receipts_insert') then
    execute $p$create policy receipts_insert on public.payment_receipts for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor') and created_by = auth.uid() and status in ('pendente', 'duplicado'))$p$;
  end if;
end $do$;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_receipts' and policyname = 'receipts_update') then
    execute $p$create policy receipts_update on public.payment_receipts for update to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor') and status in ('pendente', 'duplicado'))
  with check (org_id = app.current_org() and (status not in ('confirmado', 'rejeitado') or reviewed_by = auth.uid()))$p$;
  end if;
end $do$;

-- ---------------------------------------------------------------------------
-- Financeiro (lançamentos)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('entrada', 'saida')),
  category text not null check (length(category) between 1 and 60),
  description text not null check (length(description) between 1 and 200),
  amount_cents bigint not null check (amount_cents > 0),
  date date not null,
  sale_id uuid,
  receipt_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (org_id, sale_id) references public.sales (org_id, id) on delete set null (sale_id)
);
create index if not exists finance_entries_org_id_date_idx on public.finance_entries (org_id, date desc);
alter table public.finance_entries enable row level security;
revoke all on public.finance_entries from public, anon, authenticated;
grant select on public.finance_entries to authenticated;
grant insert (id, org_id, kind, category, description, amount_cents, date, sale_id, receipt_id, created_by, created_at) on public.finance_entries to authenticated;
grant select, insert, update, delete on public.finance_entries to service_role;
-- Lançamentos não são editados nem apagados: correções viram novos lançamentos (estornos).
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_entries' and policyname = 'finance_select') then
    execute $p$create policy finance_select on public.finance_entries for select to authenticated using (org_id = app.current_org() and app.has_role('admin', 'gestor'))$p$;
  end if;
end $do$;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_entries' and policyname = 'finance_insert') then
    execute $p$create policy finance_insert on public.finance_entries for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor') and created_by = auth.uid())$p$;
  end if;
end $do$;

-- ---------------------------------------------------------------------------
-- Ordens de produção
-- ---------------------------------------------------------------------------
create table if not exists public.production_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number integer not null check (number > 0),
  sale_id uuid,
  client_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  checklist jsonb not null default '[]' check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 50),
  stage text not null default 'fila' check (stage in ('fila', 'producao', 'revisao', 'entregue', 'cancelada')),
  assignee_id uuid,
  due_date date,
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (org_id, number),
  foreign key (org_id, sale_id) references public.sales (org_id, id) on delete set null (sale_id),
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete restrict,
  foreign key (org_id, assignee_id) references public.profiles (org_id, id) on delete set null (assignee_id)
);
-- Uma ordem por venda
create unique index if not exists production_orders_one_per_sale on public.production_orders (org_id, sale_id) where sale_id is not null;
create index if not exists production_orders_org_id_stage_updated_at_idx on public.production_orders (org_id, stage, updated_at desc);
alter table public.production_orders enable row level security;
revoke all on public.production_orders from public, anon, authenticated;
grant select on public.production_orders to authenticated;
grant insert (id, org_id, number, sale_id, client_id, title, checklist, stage, assignee_id, due_date, notes, created_at, updated_at, delivered_at) on public.production_orders to authenticated;
grant update (checklist, stage, assignee_id, due_date, notes, updated_at, delivered_at) on public.production_orders to authenticated;
grant select, insert, update, delete on public.production_orders to service_role;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'production_orders' and policyname = 'production_select') then
    execute $p$create policy production_select on public.production_orders for select to authenticated using (org_id = app.current_org())$p$;
  end if;
end $do$;
-- Toda ordem nasce na fila (as criadas pela baixa do pagamento e as avulsas).
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'production_orders' and policyname = 'production_insert') then
    execute $p$create policy production_insert on public.production_orders for insert to authenticated
  with check (org_id = app.current_org() and stage = 'fila' and delivered_at is null)$p$;
  end if;
end $do$;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'production_orders' and policyname = 'production_update') then
    execute $p$create policy production_update on public.production_orders for update to authenticated
  using (org_id = app.current_org() and stage not in ('entregue', 'cancelada'))
  with check (org_id = app.current_org() and (stage <> 'cancelada' or app.has_role('admin', 'gestor')))$p$;
  end if;
end $do$;

-- ---------------------------------------------------------------------------
-- Guardian (eventos de monitoramento): gravados só pelo servidor, lidos só por administradores
-- ---------------------------------------------------------------------------
create table if not exists public.guardian_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  level text not null check (level in ('info', 'aviso', 'erro')),
  source text not null check (length(source) <= 40),
  message text not null check (length(message) <= 500),
  at timestamptz not null default now()
);
create index if not exists guardian_events_at_idx on public.guardian_events (at desc);
alter table public.guardian_events enable row level security;
revoke all on public.guardian_events from public, anon, authenticated;
grant select on public.guardian_events to authenticated;
grant select, insert, delete on public.guardian_events to service_role;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'guardian_events' and policyname = 'guardian_select') then
    execute $p$create policy guardian_select on public.guardian_events for select to authenticated
  using ((org_id is null or org_id = app.current_org()) and app.has_role('admin'))$p$;
  end if;
end $do$;

commit;
