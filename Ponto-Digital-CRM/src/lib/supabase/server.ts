import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { env } from "../env";

export const isSupabase = () => env().DATA_BACKEND === "supabase";

/**
 * Cliente Supabase do servidor, autenticado com a sessão do usuário (cookies).
 * Usa somente a chave publicável: toda leitura/escrita passa pelo RLS do banco.
 */
export const supabaseServer = cache(async () => {
  // A biblioteca do Supabase consulta o relógio (validade da sessão): só no momento da requisição.
  await connection();
  const e = env();
  const store = await cookies();
  return createServerClient(e.SUPABASE_URL!, e.SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components não podem gravar cookies; o proxy renova a sessão.
        }
      },
    },
  });
});

/** Mensagem amigável para erros do banco (sem expor detalhes internos). */
export function dbError(err: { code?: string; message?: string } | null, fallback = "Não foi possível salvar. Tente novamente.") {
  if (!err) return fallback;
  if (err.code === "23505") return "Registro duplicado.";
  if (err.code === "42501") return "Você não tem permissão para esta ação.";
  if (err.code === "23503") return "Registro relacionado não encontrado.";
  if (err.code === "23514") return "Dados inválidos.";
  console.warn("[supabase]", err.code, err.message);
  return fallback;
}
