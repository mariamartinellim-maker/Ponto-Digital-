-- =============================================================================
-- WhatsApp Web por QR Code — MÓDULO EXPERIMENTAL (não oficial)
-- Guarda a sessão do aparelho vinculado (chip de teste), criptografada pelo servidor
-- (AES-256-GCM com WAWEB_SESSION_KEY), para sobreviver a reinícios e deploys.
-- Acesso SOMENTE pelo servidor (service_role): usuários do CRM não leem nem gravam.
-- Não altera nenhuma tabela existente.
-- =============================================================================
create table public.waweb_sessions (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  session_enc text not null check (session_enc like 'v1.%' and length(session_enc) <= 5000000),
  phone text check (phone is null or phone ~ '^[0-9]{10,15}$'),
  updated_at timestamptz not null default now()
);
alter table public.waweb_sessions enable row level security;
-- Sem políticas: com RLS ligado, anon e authenticated não enxergam nenhuma linha.
revoke all on public.waweb_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.waweb_sessions to service_role;

comment on table public.waweb_sessions is 'Sessão criptografada do WhatsApp Web experimental (chip de teste). Acesso só pelo servidor.';
