"use server";

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp, createSession, destroySession, getSessionUser } from "@/lib/auth/session";
import { hashPassword, isStrongPassword, PASSWORD_RULES, randomToken, sha256, verifyPassword } from "@/lib/auth/password";
import { audit, now } from "@/lib/data/repo";
import { getDb, mutate } from "@/lib/data/store";
import { env } from "@/lib/env";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";

export type FormState = { error?: string; ok?: string } | undefined;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(1).max(128),
  next: z.string().optional(),
});

// Hash fixo usado para equalizar o tempo de resposta quando o e-mail não existe.
let dummyHash: Promise<string> | null = null;

export async function loginAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Informe e-mail e senha válidos." };
  const { email, password } = parsed.data;
  const ip = (await clientIp()) ?? "local";

  const limitKey = `login:${ip}:${email}`;
  const rl = rateLimit(limitKey, 5, 15 * 60_000);
  if (!rl.ok) {
    return { error: `Muitas tentativas. Tente novamente em ${Math.ceil(rl.retryAfterMs / 60_000)} min.` };
  }

  const db = await getDb();
  const user = db.users.find((u) => u.email === email);
  dummyHash ??= hashPassword(randomToken());
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok || !user.active) {
    await audit({ orgId: user?.orgId ?? db.organizations[0]!.id, userId: user?.id ?? null, action: "auth.login_falhou", entity: "usuario", entityId: user?.id ?? null, details: email, ip });
    return { error: user && !user.active && ok ? "Usuário desativado. Fale com o administrador." : "E-mail ou senha incorretos." };
  }
  resetRateLimit(limitKey);
  await mutate(() => {
    user.lastLoginAt = now();
  });
  await createSession(user);
  await audit({ orgId: user.orgId, userId: user.id, action: "auth.login", entity: "usuario", entityId: user.id, ip });

  const next = parsed.data.next;
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  const user = await getSessionUser();
  if (user) await audit({ orgId: user.orgId, userId: user.id, action: "auth.logout", entity: "usuario", entityId: user.id, ip: await clientIp() });
  await destroySession();
  redirect("/login");
}

const GENERIC_RESET = "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha em instantes.";

export async function requestResetAction(_: FormState, formData: FormData): Promise<FormState> {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Informe um e-mail válido." };
  const ip = (await clientIp()) ?? "local";
  if (!rateLimit(`reset:${ip}`, 5, 60 * 60_000).ok) return { ok: GENERIC_RESET };

  const db = await getDb();
  const user = db.users.find((u) => u.email === email.data && u.active);
  if (user) {
    const token = randomToken();
    await mutate((d) => {
      d.passwordResets = d.passwordResets.filter((r) => r.userId !== user.id && r.expiresAt > now());
      d.passwordResets.push({ tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), usedAt: null });
    });
    const link = `${env().APP_URL}/redefinir-senha?token=${token}`;
    // MODO DEMO: em vez de enviar e-mail, grava o link no console do servidor e em .data/outbox.log.
    // Com Supabase, o envio passa a ser feito por supabase.auth.resetPasswordForEmail().
    console.info(`[e-mail simulado] Redefinição de senha para ${user.email}: ${link}`);
    try {
      const file = path.join(process.cwd(), ".data", "outbox.log");
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${new Date().toISOString()} | Para: ${user.email} | Redefinir senha: ${link}\n`, { mode: 0o600 });
    } catch {}
    await audit({ orgId: user.orgId, userId: user.id, action: "auth.reset_solicitado", entity: "usuario", entityId: user.id, ip });
  }
  return { ok: GENERIC_RESET };
}

export async function resetPasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!isStrongPassword(password)) return { error: PASSWORD_RULES };
  if (password !== confirm) return { error: "As senhas não conferem." };

  const db = await getDb();
  const reset = db.passwordResets.find((r) => r.tokenHash === sha256(token) && !r.usedAt && r.expiresAt > now());
  const user = reset && db.users.find((u) => u.id === reset.userId);
  if (!reset || !user) return { error: "Link inválido ou expirado. Solicite um novo." };

  const hash = await hashPassword(password);
  await mutate(() => {
    reset.usedAt = now();
    user.passwordHash = hash;
    user.sessionVersion += 1; // encerra sessões abertas em outros aparelhos
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "auth.senha_redefinida", entity: "usuario", entityId: user.id, ip: await clientIp() });
  return { ok: "Senha alterada com sucesso. Faça login com a nova senha." };
}
