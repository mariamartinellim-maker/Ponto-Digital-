-- =============================================================================
-- Ponto Digital CRM — esquema inicial (Supabase / PostgreSQL)
--
-- Isolamento de dados: toda tabela tem org_id e Row Level Security (RLS).
-- Um usuário autenticado só enxerga linhas da própria organização, e as ações
-- sensíveis dependem do perfil (admin / gestor / atendente).
-- Os registros de auditoria e de consentimento são somente-inclusão (append-only).
-- =============================================================================

create extension if not exists pgcrypto;

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type app.role as enum ('admin', 'gestor', 'atendente');
create type app.stage as enum ('novo_lead', 'em_atendimento', 'proposta_enviada', 'fechado', 'perdido');
create type app.consent_status as enum ('opt_in', 'opt_out', 'desconhecido');
create type app.consent_source as enum ('formulario', 'whatsapp', 'importacao', 'manual', 'palavra_chave', 'campanha');
create type app.conversation_status as enum ('aberta', 'pendente', 'resolvida');
create type app.message_origin as enum ('cliente', 'crm', 'app_business', 'campanha', 'historico', 'sistema');
create type app.message_status as enum ('recebida', 'simulada', 'enviada', 'entregue', 'lida', 'falhou');
create type app.template_category as enum ('MARKETING', 'UTILITY', 'AUTHENTICATION');
create type app.template_status as enum ('APPROVED', 'PENDING', 'REJECTED');
create type app.campaign_status as enum ('rascunho', 'concluida', 'cancelada');
create type app.recipient_status as enum ('simulada', 'enviada', 'entregue', 'lida', 'falhou', 'respondeu', 'descadastrou');
create type app.task_type as enum ('retorno', 'ligacao', 'reuniao', 'proposta', 'outro');

-- ---------------------------------------------------------------------------
-- Organizações e perfis (perfil = usuário do Supabase Auth + organização + papel)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  -- número WhatsApp vinculado (phone_number_id da Cloud API) para rotear webhooks
  wa_phone_number_id text unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(name) between 2 and 80),
  email text not null,
  role app.role not null default 'atendente',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create index on public.profiles (org_id);

-- Funções auxiliares usadas nas políticas (security definer evita recursão de RLS).
create or replace function app.current_org() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.org_id from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function app.current_role() returns app.role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function app.has_role(variadic roles app.role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.current_role() = any (roles), false)
$$;

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

-- ---------------------------------------------------------------------------
-- Clientes, consentimento e oportunidades
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  -- chave de deduplicação (Brasil: ignora o nono dígito)
  phone_key text generated always as (
    case when phone ~ '^55[0-9]{2}9[0-9]{8}$' then substr(phone, 1, 4) || substr(phone, 6) else phone end
  ) stored,
  email text not null default '',
  city text not null default '',
  services text[] not null default '{}',
  tags text[] not null default '{}',
  notes text not null default '' check (length(notes) <= 4000),
  owner_id uuid references public.profiles (id) on delete set null,
  consent_status app.consent_status not null default 'desconhecido',
  consent_source app.consent_source,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_contact_at timestamptz,
  unique (org_id, phone_key)
);
create index on public.clients (org_id, name);
create index on public.clients (org_id, city);

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  status app.consent_status not null check (status <> 'desconhecido'),
  source app.consent_source not null,
  note text not null default '',
  by_user_id uuid references public.profiles (id) on delete set null,
  at timestamptz not null default now()
);
create index on public.consent_events (client_id, at desc);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null check (length(title) between 1 and 140),
  value_cents bigint not null default 0 check (value_cents >= 0),
  stage app.stage not null default 'novo_lead',
  owner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on public.deals (org_id, stage);

-- ---------------------------------------------------------------------------
-- Atendimento (WhatsApp)
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  assignee_id uuid references public.profiles (id) on delete set null,
  status app.conversation_status not null default 'aberta',
  unread integer not null default 0,
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  unique (org_id, client_id)
);
create index on public.conversations (org_id, status, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  origin app.message_origin not null,
  body text not null check (length(body) <= 4096),
  status app.message_status not null,
  -- idempotência dos webhooks: a Meta pode reenviar o mesmo evento
  wa_message_id text,
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, wa_message_id)
);
create index on public.messages (conversation_id, created_at);

create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  shortcut text not null check (shortcut ~ '^[a-z0-9_-]{2,20}$'),
  title text not null,
  body text not null check (length(body) <= 1000),
  unique (org_id, shortcut)
);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_]{3,60}$'),
  category app.template_category not null,
  language text not null default 'pt_BR',
  body text not null check (length(body) <= 1024),
  status app.template_status not null default 'PENDING',
  meta_template_id text,
  created_at timestamptz not null default now(),
  unique (org_id, name, language)
);

-- ---------------------------------------------------------------------------
-- Campanhas
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  template_id uuid not null references public.message_templates (id),
  segment jsonb not null default '{"cities":[],"services":[],"stages":[],"tags":[]}',
  mode text not null default 'simulacao' check (mode in ('simulacao', 'live')),
  status app.campaign_status not null default 'rascunho',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  excluded_no_consent integer not null default 0,
  excluded_opt_out integer not null default 0
);

create table public.campaign_recipients (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  status app.recipient_status not null,
  wa_message_id text,
  primary key (campaign_id, client_id)
);
create index on public.campaign_recipients (org_id, wa_message_id);

-- Trava no banco: nenhuma campanha em modo "live" sem consentimento do destinatário.
create or replace function app.check_recipient_consent() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select consent_status from public.clients where id = new.client_id) <> 'opt_in' then
    raise exception 'Destinatário sem consentimento (opt-in) não pode receber campanhas';
  end if;
  return new;
end $$;
create trigger campaign_recipient_consent before insert on public.campaign_recipients
  for each row execute function app.check_recipient_consent();

-- ---------------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (length(title) between 2 and 140),
  type app.task_type not null default 'outro',
  client_id uuid references public.clients (id) on delete set null,
  assignee_id uuid references public.profiles (id) on delete set null,
  due_at timestamptz not null,
  done boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index on public.tasks (org_id, assignee_id, due_at);

-- ---------------------------------------------------------------------------
-- Auditoria e webhooks
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  details text not null default '',
  ip inet,
  at timestamptz not null default now()
);
create index on public.audit_logs (org_id, at desc);

create table public.webhook_events (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  field text not null,
  summary text not null,
  received_at timestamptz not null default now()
);

-- Auditoria e consentimentos não podem ser alterados nem apagados por usuários.
create or replace function app.deny_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Registro somente-inclusão: % não permitido em %', tg_op, tg_table_name;
end $$;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row when (current_user <> 'postgres') execute function app.deny_change();
create trigger consent_events_append_only before update or delete on public.consent_events
  for each row when (current_user <> 'postgres') execute function app.deny_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.consent_events enable row level security;
alter table public.deals enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.quick_replies enable row level security;
alter table public.message_templates enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.tasks enable row level security;
alter table public.audit_logs enable row level security;
alter table public.webhook_events enable row level security;

-- Organização: leitura da própria
create policy org_select on public.organizations for select to authenticated using (id = app.current_org());

-- Perfis: todos da organização leem; só admin altera
create policy profiles_select on public.profiles for select to authenticated using (org_id = app.current_org());
create policy profiles_admin on public.profiles for all to authenticated
  using (org_id = app.current_org() and app.has_role('admin'))
  with check (org_id = app.current_org() and app.has_role('admin'));

-- Clientes: equipe lê/cria/edita; excluir (LGPD) só admin
create policy clients_select on public.clients for select to authenticated using (org_id = app.current_org());
create policy clients_insert on public.clients for insert to authenticated with check (org_id = app.current_org());
create policy clients_update on public.clients for update to authenticated using (org_id = app.current_org()) with check (org_id = app.current_org());
create policy clients_delete on public.clients for delete to authenticated using (org_id = app.current_org() and app.has_role('admin'));

create policy consent_select on public.consent_events for select to authenticated using (org_id = app.current_org());
create policy consent_insert on public.consent_events for insert to authenticated with check (org_id = app.current_org());

create policy deals_rw on public.deals for all to authenticated using (org_id = app.current_org()) with check (org_id = app.current_org());

-- Conversas: admin/gestor veem todas; atendente vê as suas e as sem responsável
create policy conv_select on public.conversations for select to authenticated using (
  org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid() or assignee_id is null)
);
create policy conv_insert on public.conversations for insert to authenticated with check (org_id = app.current_org());
create policy conv_update on public.conversations for update to authenticated using (
  org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid() or assignee_id is null)
) with check (org_id = app.current_org());

create policy msg_select on public.messages for select to authenticated using (
  org_id = app.current_org() and exists (select 1 from public.conversations c where c.id = conversation_id)
);
create policy msg_insert on public.messages for insert to authenticated with check (
  org_id = app.current_org() and exists (select 1 from public.conversations c where c.id = conversation_id)
);

create policy qr_select on public.quick_replies for select to authenticated using (org_id = app.current_org());
create policy qr_manage on public.quick_replies for all to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor'))
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor'));

create policy tpl_select on public.message_templates for select to authenticated using (org_id = app.current_org());
create policy tpl_manage on public.message_templates for all to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor'))
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor'));

create policy camp_select on public.campaigns for select to authenticated using (org_id = app.current_org());
create policy camp_manage on public.campaigns for all to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor'))
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor'));
create policy camp_rcpt_select on public.campaign_recipients for select to authenticated using (org_id = app.current_org());
create policy camp_rcpt_manage on public.campaign_recipients for all to authenticated
  using (org_id = app.current_org() and app.has_role('admin', 'gestor'))
  with check (org_id = app.current_org() and app.has_role('admin', 'gestor'));

-- Tarefas: admin/gestor gerenciam todas; atendente só as próprias
create policy tasks_select on public.tasks for select to authenticated using (org_id = app.current_org());
create policy tasks_write on public.tasks for all to authenticated
  using (org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid()))
  with check (org_id = app.current_org() and (app.has_role('admin', 'gestor') or assignee_id = auth.uid()));

-- Auditoria: qualquer usuário registra; só admin lê
create policy audit_insert on public.audit_logs for insert to authenticated with check (org_id = app.current_org());
create policy audit_select on public.audit_logs for select to authenticated using (org_id = app.current_org() and app.has_role('admin'));

create policy webhook_select on public.webhook_events for select to authenticated using (org_id = app.current_org() and app.has_role('admin'));
-- Inserção de webhooks é feita somente pelo servidor com a service role (ignora RLS).

-- Nenhum acesso anônimo
revoke all on all tables in schema public from anon;
