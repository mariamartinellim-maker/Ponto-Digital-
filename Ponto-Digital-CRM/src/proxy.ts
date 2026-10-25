import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/auth/token";

const PUBLIC = ["/login", "/esqueci-senha", "/redefinir-senha", "/offline", "/auth/callback"];

function toLogin(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
  return NextResponse.redirect(url);
}

/**
 * Checagem otimista: sem sessão válida → redireciona ao login.
 * A autorização definitiva (usuário ativo, permissões) é refeita no servidor em cada página e ação.
 */
export async function proxy(req: NextRequest) {
  const isPublic = PUBLIC.some((p) => req.nextUrl.pathname === p || req.nextUrl.pathname.startsWith(p + "/"));

  if (process.env.DATA_BACKEND === "supabase") {
    // Renova os tokens do Supabase Auth e grava os cookies atualizados na resposta.
    let res = NextResponse.next({ request: req });
    const sb = createServerClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) req.cookies.set(name, value);
          res = NextResponse.next({ request: req });
          for (const { name, value, options } of list) res.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await sb.auth.getClaims();
    if (!data?.claims && !isPublic) return toLogin(req);
    return res;
  }

  const secret = process.env.SESSION_SECRET ?? "";
  const session = secret ? await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret) : null;
  if (!session && !isPublic) return toLogin(req);
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/webhooks|api/health|_next/static|_next/image|icons/|icon.svg|manifest.webmanifest|sw.js|robots.txt).*)"],
};
