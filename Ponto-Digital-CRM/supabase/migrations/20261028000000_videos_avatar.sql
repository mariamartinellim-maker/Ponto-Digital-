-- =============================================================================
-- Vídeos com avatar (táxi/Uber): pedidos de vídeo e o andamento de cada um.
--
--  * Só CRIA a tabela video_orders, seus índices e políticas de acesso (RLS).
--  * NÃO altera, renomeia ou apaga nenhuma tabela, coluna ou dado existente.
--  * Idempotente: pode ser executada mais de uma vez (o que já existe é mantido).
--  * Tudo numa transação: se qualquer verificação falhar, nada é gravado.
--
-- Os arquivos (foto, avatar, vídeo, prévia com marca d'água, comprovante) ficam na
-- biblioteca de mídias (media_assets + bucket privado "crm-arquivos").
-- Execute no SQL Editor do Supabase somente após aprovação.
-- =============================================================================
begin;

do $check$
declare missing text[] := '{}';
begin
  if to_regclass('public.organizations') is null then missing := array_append(missing, 'tabela organizations'); end if;
  if to_regclass('public.clients') is null then missing := array_append(missing, 'tabela clients'); end if;
  if to_regclass('public.media_assets') is null then missing := array_append(missing, 'tabela media_assets (migração operacional)'); end if;
  if to_regprocedure('app.current_org()') is null then missing := array_append(missing, 'função app.current_org()'); end if;
  if to_regprocedure('app.has_role(app.role[])') is null then missing := array_append(missing, 'função app.has_role()'); end if;
  if cardinality(missing) > 0 then
    raise exception 'Pré-requisitos ausentes: %. Nada foi alterado.', array_to_string(missing, ', ');
  end if;
end $check$;

create table if not exists public.video_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number integer not null check (number > 0),
  client_id uuid not null,
  conversation_id uuid,
  modality text not null check (modality in ('uber', 'taxi')),
  driver_name text not null check (length(driver_name) between 1 and 80),
  driver_gender text not null default 'masculino' check (driver_gender in ('masculino', 'feminino')),
  city text not null default '' check (length(city) <= 80),
  speech text not null check (length(speech) between 1 and 400),
  contact_phone text not null default '' check (length(contact_phone) <= 30),
  adjustments text not null default '' check (length(adjustments) <= 1000),
  status text not null default 'foto_recebida' check (status in (
    'foto_recebida', 'gerando_avatar', 'avatar_pronto', 'avatar_enviado', 'gerando_video', 'video_pronto',
    'aguardando_pagamento', 'pago', 'entregue', 'falhou', 'cancelado')),
  photo_asset_id uuid not null,
  avatar_asset_id uuid,
  video_asset_id uuid,
  preview_asset_id uuid,
  receipt_asset_id uuid,
  avatar_runs integer not null default 0 check (avatar_runs between 0 and 20),
  video_runs integer not null default 0 check (video_runs between 0 and 20),
  engine text not null default 'simulador' check (engine in ('simulador', 'ia')),
  error text check (length(error) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  avatar_sent_at timestamptz,
  preview_sent_at timestamptz,
  paid_at timestamptz,
  delivered_at timestamptz,
  unique (org_id, number),
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete restrict
);
create index if not exists video_orders_org_status_idx on public.video_orders (org_id, status, updated_at desc);
create index if not exists video_orders_org_created_idx on public.video_orders (org_id, created_at desc);
alter table public.video_orders enable row level security;
revoke all on public.video_orders from public, anon, authenticated;
grant select on public.video_orders to authenticated;
grant insert (id, org_id, number, client_id, conversation_id, modality, driver_name, driver_gender, city, speech, contact_phone, adjustments, status,
  photo_asset_id, engine, created_by, created_at, updated_at) on public.video_orders to authenticated;
-- As etapas pagas (avatar e vídeo) e os arquivos gerados são gravados só pelo servidor (service_role).
grant update (adjustments, status, avatar_sent_at, preview_sent_at, paid_at, delivered_at, receipt_asset_id, error, updated_at) on public.video_orders to authenticated;
grant select, insert, update, delete on public.video_orders to service_role;

do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'video_orders' and policyname = 'video_select') then
    execute $p$create policy video_select on public.video_orders for select to authenticated using (org_id = app.current_org())$p$;
  end if;
  -- Todo pedido nasce com a foto recebida, criado pelo próprio usuário.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'video_orders' and policyname = 'video_insert') then
    execute $p$create policy video_insert on public.video_orders for insert to authenticated
      with check (org_id = app.current_org() and status = 'foto_recebida' and created_by = auth.uid())$p$;
  end if;
  -- Pedidos entregues ou cancelados não mudam mais; só admin/gestor cancelam.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'video_orders' and policyname = 'video_update') then
    execute $p$create policy video_update on public.video_orders for update to authenticated
      using (org_id = app.current_org() and status not in ('entregue', 'cancelado'))
      with check (org_id = app.current_org() and (status <> 'cancelado' or app.has_role('admin', 'gestor')))$p$;
  end if;
end $pol$;

commit;
