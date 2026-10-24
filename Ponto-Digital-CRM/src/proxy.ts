import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/auth/token";

const PUBLIC = ["/login", "/esqueci-senha", "/redefinir-senha", "/offline"];

/**
 * Checagem otimista: sem sessão válida → redireciona ao login.
 * A autorização definitiva (usuário ativo, permissões) é refeita no servidor em cada página e ação.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const secret = process.env.SESSION_SECRET ?? "";
  const session = secret ? await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret) : null;

  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/webhooks|_next/static|_next/image|icons/|icon.svg|manifest.webmanifest|sw.js|robots.txt).*)"],
};
