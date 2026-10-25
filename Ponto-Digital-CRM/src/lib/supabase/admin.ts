import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

/*
 * Cliente com a chave SECRETA do Supabase (ignora o RLS). Uso restrito, verificado pelo ESLint
 * (regra no-restricted-imports em eslint.config.mjs), a:
 *   - gravação dos eventos do webhook oficial do WhatsApp (não há usuário logado);
 *   - conta do WhatsApp conectada (token criptografado);
 *   - convite e bloqueio de membros da equipe (Supabase Auth Admin).
 * Toda regra de negócio sensível continua no banco (funções wa_ingest_*).
 */
let client: SupabaseClient | null = null;

export const hasSupabaseAdmin = () => env().DATA_BACKEND === "supabase" && Boolean(env().SUPABASE_SECRET_KEY);

export function supabaseAdmin(): SupabaseClient {
  if (!hasSupabaseAdmin()) throw new Error("SUPABASE_SECRET_KEY não configurada no servidor.");
  client ??= createClient(env().SUPABASE_URL!, env().SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
