-- =============================================================================
-- REVERTE a migração operacional (operacao-idempotente.sql / 20261026010000).
-- Remove SOMENTE as 6 tabelas novas, e só se estiverem VAZIAS.
-- Não toca em clients, conversations, messages, deals nem em nenhuma outra tabela.
-- Tudo numa transação: se alguma tabela nova tiver dados, aborta sem remover nada.
-- =============================================================================
begin;

do $check$
declare t text; n bigint;
begin
  foreach t in array array['guardian_events', 'production_orders', 'finance_entries', 'payment_receipts', 'sales', 'media_assets'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'A tabela % tem % registro(s). Reversão cancelada; nada foi removido.', t, n;
      end if;
    end if;
  end loop;
end $check$;

-- Ordem inversa das dependências (sem CASCADE: se algo inesperado depender delas, aborta).
drop table if exists public.guardian_events;
drop table if exists public.production_orders;
drop table if exists public.finance_entries;
drop table if exists public.payment_receipts;
drop table if exists public.sales;
drop table if exists public.media_assets;

commit;
