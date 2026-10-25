"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSupabase, SUPABASE_PROXIMA_ETAPA } from "@/lib/supabase/server";
import { authorize, clientIp } from "@/lib/auth/session";
import { audit, now } from "@/lib/data/repo";
import { mutate } from "@/lib/data/store";

export type FormState = { error?: string; ok?: number } | undefined;

const qrSchema = z.object({
  shortcut: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,20}$/, "Atalho: 2 a 20 letras/números, sem espaços."),
  title: z.string().trim().min(2).max(60),
  body: z.string().trim().min(2).max(1000),
});

export async function saveQuickReplyAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await authorize("quick_replies:manage");
  if (isSupabase()) return { error: SUPABASE_PROXIMA_ETAPA };
  const parsed = qrSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;
  const err = await mutate((db) => {
    if (db.quickReplies.some((q) => q.orgId === user.orgId && q.shortcut === v.shortcut)) return "Já existe uma resposta com este atalho.";
    db.quickReplies.push({ id: randomUUID(), orgId: user.orgId, ...v });
    return null;
  });
  if (err) return { error: err };
  await audit({ orgId: user.orgId, userId: user.id, action: "resposta_rapida.criada", entity: "resposta_rapida", entityId: null, details: v.shortcut, ip: await clientIp() });
  revalidatePath("/modelos");
  return { ok: Date.now() };
}

export async function deleteQuickReplyAction(formData: FormData) {
  const user = await authorize("quick_replies:manage");
  if (isSupabase()) throw new Error(SUPABASE_PROXIMA_ETAPA);
  const id = String(formData.get("id"));
  await mutate((db) => {
    db.quickReplies = db.quickReplies.filter((q) => !(q.id === id && q.orgId === user.orgId));
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "resposta_rapida.excluida", entity: "resposta_rapida", entityId: id, ip: await clientIp() });
  revalidatePath("/modelos");
}

const tplSchema = z.object({
  name: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,60}$/, "Nome: letras minúsculas, números e _ (padrão da Meta)."),
  category: z.enum(["MARKETING", "UTILITY"]),
  body: z.string().trim().min(5).max(1024),
});

/**
 * Cria o modelo como PENDENTE. Na integração oficial, este passo envia o modelo para
 * aprovação da Meta (POST /{WABA_ID}/message_templates) e o status chega por webhook.
 */
export async function saveTemplateAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await authorize("templates:manage");
  if (isSupabase()) return { error: SUPABASE_PROXIMA_ETAPA };
  const parsed = tplSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;
  if (v.category === "MARKETING" && !/sair|parar|descadastr/i.test(v.body)) {
    return { error: "Modelos de marketing devem informar como descadastrar (ex.: “Responda SAIR para não receber mais mensagens”)." };
  }
  const err = await mutate((db) => {
    if (db.templates.some((t) => t.orgId === user.orgId && t.name === v.name)) return "Já existe um modelo com este nome.";
    db.templates.push({ id: randomUUID(), orgId: user.orgId, ...v, language: "pt_BR", status: "PENDING", metaTemplateId: null, createdAt: now() });
    return null;
  });
  if (err) return { error: err };
  await audit({ orgId: user.orgId, userId: user.id, action: "modelo.criado", entity: "modelo", entityId: null, details: v.name, ip: await clientIp() });
  revalidatePath("/modelos");
  return { ok: Date.now() };
}

/** Apenas no modo demonstração: simula a resposta da Meta à análise do modelo. */
export async function simulateTemplateReviewAction(formData: FormData) {
  const user = await authorize("templates:manage");
  if (isSupabase()) throw new Error(SUPABASE_PROXIMA_ETAPA);
  const id = String(formData.get("id"));
  const status = formData.get("status") === "APPROVED" ? "APPROVED" : "REJECTED";
  await mutate((db) => {
    const t = db.templates.find((x) => x.id === id && x.orgId === user.orgId);
    if (t) t.status = status;
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "modelo.status_simulado", entity: "modelo", entityId: id, details: status, ip: await clientIp() });
  revalidatePath("/modelos");
}
