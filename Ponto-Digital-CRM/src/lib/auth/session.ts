import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "../env";
import { getDb } from "../data/store";
import { isSupabase, supabaseServer } from "../supabase/server";
import type { PublicUser, User } from "../data/types";
import { can, type Permission } from "../permissions";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "./token";

export type SessionUser = PublicUser & { orgName: string };

function toPublic(u: User, orgName: string): SessionUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, sessionVersion, ...rest } = u;
  return { ...rest, orgName };
}

/** Lê e valida a sessão (assinatura, expiração, usuário ativo e versão da sessão). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (isSupabase()) return getSupabaseSessionUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token, env().SESSION_SECRET!);
  if (!payload) return null;
  const db = await getDb();
  const user = db.users.find((u) => u.id === payload.uid && u.orgId === payload.org);
  if (!user || !user.active || user.sessionVersion !== payload.sv) return null;
  const org = db.organizations.find((o) => o.id === user.orgId);
  return toPublic(user, org?.name ?? "");
});

/**
 * Modo Supabase: valida o usuário no Supabase Auth (getUser consulta o servidor de
 * autenticação) e lê o perfil pelo RLS. Usuário sem perfil ou desativado = sem acesso.
 */
async function getSupabaseSessionUser(): Promise<SessionUser | null> {
  const sb = await supabaseServer();
  const { data: auth, error } = await sb.auth.getUser();
  if (error || !auth.user) return null;
  const { data: p } = await sb
    .from("profiles")
    .select("id,org_id,name,email,role,active,created_at,last_login_at")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!p || !p.active) return null;
  const { data: org } = await sb.from("organizations").select("name").eq("id", p.org_id).maybeSingle();
  return {
    id: p.id,
    orgId: p.org_id,
    name: p.name,
    email: p.email,
    role: p.role,
    active: p.active,
    createdAt: p.created_at,
    lastLoginAt: p.last_login_at,
    orgName: org?.name ?? "",
  };
}

/** Data Access Layer: exige usuário autenticado (e, opcionalmente, uma permissão). */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect("/sem-permissao");
  return user;
}

/** Para Server Actions: lança erro em vez de redirecionar quando falta permissão. */
export async function authorize(permission?: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) {
    throw new Error("Você não tem permissão para realizar esta ação.");
  }
  return user;
}

export async function createSession(user: User) {
  const token = await signSession(
    { uid: user.id, org: user.orgId, sv: user.sessionVersion, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS },
    env().SESSION_SECRET!,
  );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}
