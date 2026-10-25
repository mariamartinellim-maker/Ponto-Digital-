import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabase, supabaseServer } from "@/lib/supabase/server";

/**
 * Retorno do link enviado por e-mail pelo Supabase (recuperação de senha).
 * Troca o código por uma sessão temporária e abre a tela de nova senha.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = url.searchParams.get("next") === "/redefinir-senha" ? "/redefinir-senha" : "/dashboard";
  const fail = new URL("/redefinir-senha?erro=link", url.origin);
  if (!isSupabase()) return NextResponse.redirect(new URL("/login", url.origin));

  const sb = await supabaseServer();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const { error } = code
    ? await sb.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await sb.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("sem código") };
  if (error) return NextResponse.redirect(fail);

  const dest = new URL(next, url.origin);
  if (next === "/redefinir-senha") dest.searchParams.set("token", "supabase");
  return NextResponse.redirect(dest);
}
