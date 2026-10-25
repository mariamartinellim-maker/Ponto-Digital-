"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { hasSupabaseAdmin, supabaseAdmin } from "@/lib/supabase/admin";
import { dbError, isSupabase, supabaseServer } from "@/lib/supabase/server";
import { authorize, clientIp } from "@/lib/auth/session";
import { hashPassword, randomToken } from "@/lib/auth/password";
import { audit, now } from "@/lib/data/repo";
import { getDb, mutate } from "@/lib/data/store";
import type { Role } from "@/lib/data/types";

export type TeamState = { error?: string; ok?: string } | undefined;

const tempPassword = () => randomToken(9).replace(/[-_]/g, "x") + "7k";

const createSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(80),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(160),
  role: z.enum(["admin", "gestor", "atendente"]),
});

export async function createUserAction(_: TeamState, formData: FormData): Promise<TeamState> {
  const admin = await authorize("users:manage");
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;
  if (isSupabase()) return inviteSupabase(admin, v);
  const db = await getDb();
  if (db.users.some((u) => u.email === v.email)) return { error: "Já existe um usuário com este e-mail." };
  const pw = tempPassword();
  const hash = await hashPassword(pw);
  const id = randomUUID();
  await mutate((d) => {
    d.users.push({ id, orgId: admin.orgId, name: v.name, email: v.email, role: v.role, passwordHash: hash, active: true, sessionVersion: 1, createdAt: now(), lastLoginAt: null });
  });
  await audit({ orgId: admin.orgId, userId: admin.id, action: "usuario.criado", entity: "usuario", entityId: id, details: `${v.email} (${v.role})`, ip: await clientIp() });
  revalidatePath("/equipe");
  // A senha temporária é exibida UMA vez para o administrador repassar por canal seguro.
  return { ok: `Usuário criado. Senha temporária: ${pw} — repasse por canal seguro e peça para alterar pelo “Esqueci minha senha”.` };
}

/**
 * Supabase: convite por e-mail (a pessoa define a própria senha pelo link). Precisa da chave
 * secreta no servidor, usada só aqui; o perfil é gravado com a sessão do administrador (RLS).
 */
async function inviteSupabase(admin: Awaited<ReturnType<typeof authorize>>, v: z.infer<typeof createSchema>): Promise<TeamState> {
  if (!hasSupabaseAdmin()) {
    return { error: "Convites exigem a SUPABASE_SECRET_KEY no servidor. Alternativa: crie o usuário em Supabase → Authentication → Users." };
  }
  const sb = await supabaseServer();
  const { data: dup } = await sb.from("profiles").select("id").eq("email", v.email).maybeSingle();
  if (dup) return { error: "Já existe um usuário com este e-mail." };
  const { data, error } = await supabaseAdmin().auth.admin.inviteUserByEmail(v.email, {
    redirectTo: `${env().APP_URL}/auth/callback?next=/redefinir-senha`,
    data: { name: v.name },
  });
  if (error || !data.user) {
    return { error: /registered|exists/i.test(error?.message ?? "") ? "Este e-mail já tem conta no Supabase de outra organização." : "Não foi possível enviar o convite." };
  }
  const { error: pErr } = await sb.from("profiles").insert({ id: data.user.id, org_id: admin.orgId, name: v.name, email: v.email, role: v.role, active: true });
  if (pErr) {
    await supabaseAdmin().auth.admin.deleteUser(data.user.id).catch(() => null);
    return { error: dbError(pErr) };
  }
  await audit({ orgId: admin.orgId, userId: admin.id, action: "usuario.convidado", entity: "usuario", entityId: data.user.id, details: `${v.email} (${v.role})`, ip: await clientIp() });
  revalidatePath("/equipe");
  return { ok: `Convite enviado para ${v.email}. A pessoa define a própria senha pelo link do e-mail.` };
}

async function updateSupabase(admin: Awaited<ReturnType<typeof authorize>>, id: string, op: string, formData: FormData) {
  const sb = await supabaseServer();
  const { data: u } = await sb.from("profiles").select("id,role,active,in_rotation").eq("id", id).maybeSingle();
  if (!u) throw new Error("Usuário não encontrado.");
  let patch: Record<string, unknown>;
  let details: string;
  if (op === "role") {
    const role = z.enum(["admin", "gestor", "atendente"]).parse(formData.get("role"));
    patch = { role };
    details = `perfil ${u.role} → ${role}`;
  } else if (op === "toggle") {
    if (id === admin.id) throw new Error("Você não pode desativar o próprio acesso.");
    patch = { active: !u.active };
    details = u.active ? "desativado" : "reativado";
  } else if (op === "rotation") {
    patch = { in_rotation: !u.in_rotation };
    details = u.in_rotation ? "saiu do rodízio de atendimentos" : "entrou no rodízio de atendimentos";
  } else throw new Error("Operação inválida.");
  // O banco recusa deixar a organização sem administrador ativo.
  const { error } = await sb.from("profiles").update(patch).eq("id", id);
  if (error) throw new Error(/administrador/.test(error.message) ? "É necessário manter pelo menos um administrador ativo." : dbError(error));
  // Desativado: além de perder o acesso aos dados na hora (RLS), fica impedido de entrar.
  if (op === "toggle" && hasSupabaseAdmin()) {
    await supabaseAdmin().auth.admin.updateUserById(id, { ban_duration: u.active ? "876000h" : "none" }).catch(() => null);
  }
  return details;
}

function guardLastAdmin(users: { role: Role; active: boolean; orgId: string; id: string }[], orgId: string, targetId: string) {
  const admins = users.filter((u) => u.orgId === orgId && u.role === "admin" && u.active && u.id !== targetId);
  if (admins.length === 0) throw new Error("É necessário manter pelo menos um administrador ativo.");
}

export async function updateUserAction(formData: FormData) {
  const admin = await authorize("users:manage");
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  if (isSupabase()) {
    const details = await updateSupabase(admin, id, op, formData);
    await audit({ orgId: admin.orgId, userId: admin.id, action: "usuario.atualizado", entity: "usuario", entityId: id, details, ip: await clientIp() });
    revalidatePath("/equipe");
    return;
  }
  let details = op;
  await mutate((db) => {
    const u = db.users.find((x) => x.id === id && x.orgId === admin.orgId);
    if (!u) throw new Error("Usuário não encontrado.");
    if (op === "role") {
      const role = z.enum(["admin", "gestor", "atendente"]).parse(formData.get("role"));
      if (u.role === "admin" && role !== "admin") guardLastAdmin(db.users, admin.orgId, u.id);
      details = `perfil ${u.role} → ${role}`;
      u.role = role;
      u.sessionVersion += 1;
    } else if (op === "toggle") {
      if (u.active && u.role === "admin") guardLastAdmin(db.users, admin.orgId, u.id);
      u.active = !u.active;
      u.sessionVersion += 1; // encerra as sessões abertas
      details = u.active ? "reativado" : "desativado";
    } else if (op === "rotation") {
      u.inRotation = !u.inRotation;
      details = u.inRotation ? "entrou no rodízio de atendimentos" : "saiu do rodízio de atendimentos";
    }
  });
  await audit({ orgId: admin.orgId, userId: admin.id, action: "usuario.atualizado", entity: "usuario", entityId: id, details, ip: await clientIp() });
  revalidatePath("/equipe");
}

export async function resetUserPasswordAction(_: TeamState, formData: FormData): Promise<TeamState> {
  const admin = await authorize("users:manage");
  const id = String(formData.get("id"));
  if (isSupabase()) {
    // Envia o link de redefinição para o e-mail da pessoa (nenhuma senha passa pelo administrador).
    const sb = await supabaseServer();
    const { data: u } = await sb.from("profiles").select("email").eq("id", id).maybeSingle();
    if (!u) return { error: "Usuário não encontrado." };
    await sb.auth.resetPasswordForEmail(String(u.email), { redirectTo: `${env().APP_URL}/auth/callback?next=/redefinir-senha` });
    await audit({ orgId: admin.orgId, userId: admin.id, action: "usuario.redefinicao_enviada", entity: "usuario", entityId: id, ip: await clientIp() });
    return { ok: `Link de redefinição enviado para ${u.email}.` };
  }
  const pw = tempPassword();
  const hash = await hashPassword(pw);
  const ok = await mutate((db) => {
    const u = db.users.find((x) => x.id === id && x.orgId === admin.orgId);
    if (!u) return false;
    u.passwordHash = hash;
    u.sessionVersion += 1; // encerra as sessões abertas
    return true;
  });
  if (!ok) return { error: "Usuário não encontrado." };
  await audit({ orgId: admin.orgId, userId: admin.id, action: "usuario.senha_redefinida", entity: "usuario", entityId: id, ip: await clientIp() });
  return { ok: `Nova senha temporária: ${pw}` };
}

/** Distribuição de novos atendimentos do WhatsApp: manual ou rodízio entre os participantes. */
export async function setDistributionAction(formData: FormData) {
  const admin = await authorize("users:manage");
  const mode = z.enum(["manual", "rodizio"]).parse(formData.get("mode"));
  if (!isSupabase()) throw new Error("A distribuição automática funciona com o Supabase conectado.");
  const sb = await supabaseServer();
  const { error } = await sb.from("organizations").update({ wa_distribution: mode }).eq("id", admin.orgId);
  if (error) throw new Error(dbError(error));
  await audit({ orgId: admin.orgId, userId: admin.id, action: "equipe.distribuicao", entity: "organizacao", entityId: admin.orgId, details: mode, ip: await clientIp() });
  revalidatePath("/equipe");
}
