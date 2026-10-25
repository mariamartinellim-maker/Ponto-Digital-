"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasSupabaseAdmin } from "@/lib/supabase/admin";
import { dbError, isSupabase, supabaseServer } from "@/lib/supabase/server";
import { GraphError } from "@/lib/whatsapp/graph";
import { submitTemplate, syncTemplates } from "@/lib/whatsapp/templates";
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
  const parsed = qrSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;
  if (isSupabase()) {
    const sb = await supabaseServer();
    const { error } = await sb.from("quick_replies").insert({ org_id: user.orgId, ...v });
    if (error) return { error: error.code === "23505" ? "Já existe uma resposta com este atalho." : dbError(error) };
    await audit({ orgId: user.orgId, userId: user.id, action: "resposta_rapida.criada", entity: "resposta_rapida", entityId: null, details: v.shortcut });
    revalidatePath("/modelos");
    return { ok: Date.now() };
  }
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
  const id = String(formData.get("id"));
  if (isSupabase()) {
    const sb = await supabaseServer();
    const { error } = await sb.from("quick_replies").delete().eq("id", id);
    if (error) throw new Error(dbError(error));
  } else {
    await mutate((db) => {
      db.quickReplies = db.quickReplies.filter((q) => !(q.id === id && q.orgId === user.orgId));
    });
  }
  await audit({ orgId: user.orgId, userId: user.id, action: "resposta_rapida.excluida", entity: "resposta_rapida", entityId: id, ip: await clientIp() });
  revalidatePath("/modelos");
}

const tplSchema = z.object({
  name: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,60}$/, "Nome: letras minúsculas, números e _ (padrão da Meta)."),
  category: z.enum(["MARKETING", "UTILITY"]),
  body: z.string().trim().min(5).max(1024),
});

/**
 * Cria o modelo como PENDENTE no CRM. O envio para análise da Meta é um passo separado
 * (botão "Enviar para análise"); o resultado chega pelo webhook ou pela sincronização.
 */
export async function saveTemplateAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await authorize("templates:manage");
  const parsed = tplSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;
  if (v.category === "MARKETING" && !/sair|parar|descadastr/i.test(v.body)) {
    return { error: "Modelos de marketing devem informar como descadastrar (ex.: “Responda SAIR para não receber mais mensagens”)." };
  }
  if (isSupabase()) {
    const sb = await supabaseServer();
    const { error } = await sb.from("message_templates").insert({ org_id: user.orgId, name: v.name, category: v.category, body: v.body, language: "pt_BR" });
    if (error) return { error: error.code === "23505" ? "Já existe um modelo com este nome." : dbError(error) };
    await audit({ orgId: user.orgId, userId: user.id, action: "modelo.criado", entity: "modelo", entityId: null, details: v.name });
    revalidatePath("/modelos");
    return { ok: Date.now() };
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
  if (isSupabase()) throw new Error("No Supabase, o status do modelo vem da própria Meta (análise real).");
  const id = String(formData.get("id"));
  const status = formData.get("status") === "APPROVED" ? "APPROVED" : "REJECTED";
  await mutate((db) => {
    const t = db.templates.find((x) => x.id === id && x.orgId === user.orgId);
    if (t) t.status = status;
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "modelo.status_simulado", entity: "modelo", entityId: id, details: status, ip: await clientIp() });
  revalidatePath("/modelos");
}

/** Envia o modelo para análise da Meta (gratuito; não envia mensagem a nenhum cliente). */
export async function submitTemplateToMetaAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await authorize("templates:manage");
  if (!isSupabase()) return { error: "Disponível com o Supabase e o WhatsApp conectados." };
  const id = String(formData.get("id"));
  const sb = await supabaseServer();
  const { data: tpl } = await sb.from("message_templates").select("name,language,category,body,meta_template_id").eq("id", id).maybeSingle();
  if (!tpl) return { error: "Modelo não encontrado." };
  if (tpl.meta_template_id) return { error: "Este modelo já foi enviado à Meta. Use “Sincronizar com a Meta” para ver o status." };
  try {
    const r = await submitTemplate(user.orgId, { name: tpl.name, language: tpl.language, category: tpl.category, body: tpl.body });
    if (hasSupabaseAdmin()) await syncTemplates(user.orgId).catch(() => null);
    await audit({ orgId: user.orgId, userId: user.id, action: "modelo.enviado_meta", entity: "modelo", entityId: id, details: `${tpl.name} → ${r.status}` });
  } catch (err) {
    return { error: err instanceof GraphError || err instanceof Error ? err.message : "Falha ao enviar à Meta." };
  }
  revalidatePath("/modelos");
  return { ok: Date.now() };
}

export async function syncTemplatesAction(): Promise<FormState> {
  const user = await authorize("templates:manage");
  if (!isSupabase() || !hasSupabaseAdmin()) return { error: "Disponível com o Supabase (chave secreta no servidor) e o WhatsApp conectados." };
  try {
    const r = await syncTemplates(user.orgId);
    await audit({ orgId: user.orgId, userId: user.id, action: "modelo.sincronizado", entity: "modelo", entityId: null, details: `${r.total} na Meta; ${r.updated} atualizados; ${r.created} novos` });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao sincronizar." };
  }
  revalidatePath("/modelos");
  return { ok: Date.now() };
}
