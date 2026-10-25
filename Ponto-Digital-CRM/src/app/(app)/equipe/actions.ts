"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSupabase, SUPABASE_PROXIMA_ETAPA } from "@/lib/supabase/server";
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
  if (isSupabase()) return { error: SUPABASE_PROXIMA_ETAPA };
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;
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

function guardLastAdmin(users: { role: Role; active: boolean; orgId: string; id: string }[], orgId: string, targetId: string) {
  const admins = users.filter((u) => u.orgId === orgId && u.role === "admin" && u.active && u.id !== targetId);
  if (admins.length === 0) throw new Error("É necessário manter pelo menos um administrador ativo.");
}

export async function updateUserAction(formData: FormData) {
  const admin = await authorize("users:manage");
  if (isSupabase()) throw new Error(SUPABASE_PROXIMA_ETAPA);
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
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
    }
  });
  await audit({ orgId: admin.orgId, userId: admin.id, action: "usuario.atualizado", entity: "usuario", entityId: id, details, ip: await clientIp() });
  revalidatePath("/equipe");
}

export async function resetUserPasswordAction(_: TeamState, formData: FormData): Promise<TeamState> {
  const admin = await authorize("users:manage");
  if (isSupabase()) return { error: SUPABASE_PROXIMA_ETAPA };
  const id = String(formData.get("id"));
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
