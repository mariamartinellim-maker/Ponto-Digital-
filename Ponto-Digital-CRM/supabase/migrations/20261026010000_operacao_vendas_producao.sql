-- =============================================================================
-- Módulos operacionais: biblioteca de mídias, comprovantes, vendas, financeiro,
-- ordens de produção e eventos do Guardian.
-- Isolamento por organização (RLS) e perfis: admin, gestor, atendente.
-- Não altera nenhuma tabela existente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Biblioteca de mídias (arquivo no Supabase Storage, bucket privado "crm-arquivos")
-- ---------------------------------------------------------------------------
create table public.media_assets (
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
create index on public.media_assets (org_id, created_at desc);
alter table public.media_assets enable row level security;
revoke all on public.media_assets from public, anon, authenticated;
grant select, delete on public.media_assets to authenticated;
grant insert (id, org_id, title, type, mime, size, filename, tags, source, client_id, storage_key, created_by, created_at) on public.media_assets to authenticated;
grant update (title, tags, client_id) on public.media_assets to authenticated;
grant select, insert, update, delete on public.media_assets to service_role;
create policy media_select on public.media_assets for select to authenticated using (org_id = app.current_org());
create policy media_insert on public.media_assets for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor') and created_by = auth.uid());
create policy media_update on public.media_assets for update to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor')) with check (org_id = app.current_org());
create policy media_delete on public.media_assets for delete to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor'));

-- ---------------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------------
create table public.sales (
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
create index on public.sales (org_id, status, created_at desc);
alter table public.sales enable row level security;
revoke all on public.sales from public, anon, authenticated;
grant select on public.sales to authenticated;
grant insert (id, org_id, number, client_id, deal_id, conversation_id, items, total_cents, status, payment_method, due_date, paid_at, receipt_id, notes, created_by, created_at, updated_at) on public.sales to authenticated;
grant update (status, paid_at, receipt_id, notes, updated_at) on public.sales to authenticated;
grant select, insert, update, delete on public.sales to service_role;
create policy sales_select on public.sales for select to authenticated using (org_id = app.current_org());
-- Toda venda nasce aguardando pagamento: só o financeiro (admin/gestor) dá baixa.
create policy sales_insert on public.sales for insert to authenticated
  with check (org_id = app.current_org() and status = 'aguardando_pagamento' and paid_at is null and created_by = auth.uid());
-- Atendente: só mexe em vendas em aberto e nunca as marca como pagas.
create policy sales_update on public.sales for update to authenticated
  using (org_id = app.current_org() and (app.has_role('admin', 'gestor') or status = 'aguardando_pagamento'))
  with check (org_id = app.current_org() and (app.has_role('admin', 'gestor') or status <> 'pago'));

-- ---------------------------------------------------------------------------
-- Comprovantes de pagamento
-- ---------------------------------------------------------------------------
create table public.payment_receipts (
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
create index on public.payment_receipts (org_id, status, created_at desc);
alter table public.payment_receipts enable row level security;
revoke all on public.payment_receipts from public, anon, authenticated;
grant select on public.payment_receipts to authenticated;
grant insert (id, org_id, media_id, client_id, sale_id, status, data, analyzer, analysis_error, duplicate_of, reviewed_by, reviewed_at, created_by, created_at) on public.payment_receipts to authenticated;
grant update (client_id, sale_id, status, data, analyzer, analysis_error, duplicate_of, reviewed_by, reviewed_at) on public.payment_receipts to authenticated;
grant select, insert, update, delete on public.payment_receipts to service_role;
create policy receipts_select on public.payment_receipts for select to authenticated using (org_id = app.current_org() and app.has_role('admin', 'gestor'));
create policy receipts_insert on public.payment_receipts for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor') and created_by = auth.uid() and status in ('pendente', 'duplicado'));
create policy receipts_update on public.payment_receipts for update to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor') and status in ('pendente', 'duplicado'))
  with check (org_id = app.current_org() and (status not in ('confirmado', 'rejeitado') or reviewed_by = auth.uid()));

-- ---------------------------------------------------------------------------
-- Financeiro (lançamentos)
-- ---------------------------------------------------------------------------
create table public.finance_entries (
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
create index on public.finance_entries (org_id, date desc);
alter table public.finance_entries enable row level security;
revoke all on public.finance_entries from public, anon, authenticated;
grant select on public.finance_entries to authenticated;
grant insert (id, org_id, kind, category, description, amount_cents, date, sale_id, receipt_id, created_by, created_at) on public.finance_entries to authenticated;
grant select, insert, update, delete on public.finance_entries to service_role;
-- Lançamentos não são editados nem apagados: correções viram novos lançamentos (estornos).
create policy finance_select on public.finance_entries for select to authenticated using (org_id = app.current_org() and app.has_role('admin', 'gestor'));
create policy finance_insert on public.finance_entries for insert to authenticated
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor') and created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Ordens de produção
-- ---------------------------------------------------------------------------
create table public.production_orders (
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
create unique index production_orders_one_per_sale on public.production_orders (org_id, sale_id) where sale_id is not null;
create index on public.production_orders (org_id, stage, updated_at desc);
alter table public.production_orders enable row level security;
revoke all on public.production_orders from public, anon, authenticated;
grant select on public.production_orders to authenticated;
grant insert (id, org_id, number, sale_id, client_id, title, checklist, stage, assignee_id, due_date, notes, created_at, updated_at, delivered_at) on public.production_orders to authenticated;
grant update (checklist, stage, assignee_id, due_date, notes, updated_at, delivered_at) on public.production_orders to authenticated;
grant select, insert, update, delete on public.production_orders to service_role;
create policy production_select on public.production_orders for select to authenticated using (org_id = app.current_org());
-- Toda ordem nasce na fila (as criadas pela baixa do pagamento e as avulsas).
create policy production_insert on public.production_orders for insert to authenticated
  with check (org_id = app.current_org() and stage = 'fila' and delivered_at is null);
create policy production_update on public.production_orders for update to authenticated
  using (org_id = app.current_org() and stage not in ('entregue', 'cancelada'))
  with check (org_id = app.current_org() and (stage <> 'cancelada' or app.has_role('admin', 'gestor')));

-- ---------------------------------------------------------------------------
-- Guardian (eventos de monitoramento): gravados só pelo servidor, lidos só por administradores
-- ---------------------------------------------------------------------------
create table public.guardian_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  level text not null check (level in ('info', 'aviso', 'erro')),
  source text not null check (length(source) <= 40),
  message text not null check (length(message) <= 500),
  at timestamptz not null default now()
);
create index on public.guardian_events (at desc);
alter table public.guardian_events enable row level security;
revoke all on public.guardian_events from public, anon, authenticated;
grant select on public.guardian_events to authenticated;
grant select, insert, delete on public.guardian_events to service_role;
create policy guardian_select on public.guardian_events for select to authenticated
  using ((org_id is null or org_id = app.current_org()) and app.has_role('admin'));
