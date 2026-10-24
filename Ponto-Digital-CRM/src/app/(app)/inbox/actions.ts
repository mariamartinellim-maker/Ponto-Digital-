"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize, clientIp, type SessionUser } from "@/lib/auth/session";
import { appendMessage, applyWhatsAppEvents, audit, now } from "@/lib/data/repo";
import { getDb, mutate } from "@/lib/data/store";
import type { Conversation, ConversationStatus, Database } from "@/lib/data/types";
import { canSeeConversation, windowOpen } from "@/lib/inbox";
import { can } from "@/lib/permissions";
import { renderTemplate } from "@/lib/segmentation";
import { sendWhatsApp } from "@/lib/whatsapp/client";
import { parseWebhook } from "@/lib/whatsapp/events";

async function loadConv(user: SessionUser, id: string): Promise<{ db: Database; conv: Conversation }> {
  const db = await getDb();
  const conv = db.conversations.find((c) => c.id === id && c.orgId === user.orgId);
  if (!conv || !canSeeConversation(user, conv)) throw new Error("Conversa não encontrada.");
  return { db, conv };
}

export async function startConversationAction(formData: FormData) {
  const user = await authorize("inbox:reply");
  const clientId = String(formData.get("clientId"));
  const convId = await mutate((db) => {
    const client = db.clients.find((c) => c.id === clientId && c.orgId === user.orgId);
    if (!client) throw new Error("Cliente não encontrado.");
    const existing = db.conversations.find((c) => c.clientId === clientId && c.orgId === user.orgId);
    if (existing) return existing.id;
    const conv: Conversation = { id: randomUUID(), orgId: user.orgId, clientId, assigneeId: user.id, status: "aberta", unread: 0, lastMessageAt: now(), lastInboundAt: null };
    db.conversations.unshift(conv);
    return conv.id;
  });
  redirect(`/inbox/${convId}`);
}

export type SendState = { error?: string; ok?: number } | undefined;

export async function sendMessageAction(_: SendState, formData: FormData): Promise<SendState> {
  const user = await authorize("inbox:reply");
  const convId = String(formData.get("conversationId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Digite uma mensagem." };
  if (body.length > 4096) return { error: "Mensagem muito longa (máx. 4096 caracteres)." };
  const { db, conv } = await loadConv(user, convId);
  const client = db.clients.find((c) => c.id === conv.clientId)!;

  // Regra da Meta: texto livre somente até 24h após a última mensagem do cliente.
  if (!windowOpen(conv)) {
    return { error: "Fora da janela de 24h. Use um modelo (template) aprovado para retomar a conversa." };
  }
  const result = await sendWhatsApp({ type: "text", to: client.phone, body });
  if (!result.ok) return { error: `Falha no envio: ${result.error}` };

  await mutate((d) => {
    appendMessage(d, conv, { direction: "out", origin: "crm", body, status: result.simulated ? "simulada" : "enviada", waMessageId: result.waMessageId, authorId: user.id });
    if (!conv.assigneeId) conv.assigneeId = user.id;
    if (conv.status === "pendente") conv.status = "aberta";
  });
  revalidatePath(`/inbox/${convId}`);
  return { ok: Date.now() };
}

export async function sendTemplateAction(_: SendState, formData: FormData): Promise<SendState> {
  const user = await authorize("inbox:reply");
  const convId = String(formData.get("conversationId"));
  const templateId = String(formData.get("templateId"));
  const vars = formData.getAll("var").map((v) => String(v).trim().slice(0, 200));
  const { db, conv } = await loadConv(user, convId);
  const client = db.clients.find((c) => c.id === conv.clientId)!;
  const tpl = db.templates.find((t) => t.id === templateId && t.orgId === user.orgId);
  if (!tpl || tpl.status !== "APPROVED") return { error: "Selecione um modelo aprovado pela Meta." };
  if (tpl.category === "MARKETING" && client.consent.status !== "opt_in") {
    return { error: "Modelos de marketing exigem consentimento (opt-in) do cliente." };
  }
  if (vars.some((v) => !v)) return { error: "Preencha todas as variáveis do modelo." };
  const result = await sendWhatsApp({ type: "template", to: client.phone, name: tpl.name, language: tpl.language, variables: vars });
  if (!result.ok) return { error: `Falha no envio: ${result.error}` };
  await mutate((d) => {
    appendMessage(d, conv, { direction: "out", origin: "crm", body: renderTemplate(tpl.body, vars), status: result.simulated ? "simulada" : "enviada", waMessageId: result.waMessageId, authorId: user.id });
    if (!conv.assigneeId) conv.assigneeId = user.id;
  });
  revalidatePath(`/inbox/${convId}`);
  return { ok: Date.now() };
}

export async function markReadAction(convId: string) {
  const user = await authorize();
  const { conv } = await loadConv(user, convId);
  if (conv.unread === 0) return;
  await mutate(() => {
    conv.unread = 0;
  });
  revalidatePath("/inbox", "layout");
}

export async function updateConversationAction(formData: FormData) {
  const user = await authorize("inbox:reply");
  const convId = String(formData.get("conversationId"));
  const { db, conv } = await loadConv(user, convId);
  const status = formData.get("status") as ConversationStatus | null;
  const assignee = formData.get("assigneeId");
  let details = "";
  if (assignee !== null) {
    const target = String(assignee);
    const selfAssign = target === user.id && !conv.assigneeId;
    if (!selfAssign && !can(user.role, "inbox:assign")) throw new Error("Sem permissão para transferir conversas.");
    if (target && !db.users.some((u) => u.id === target && u.orgId === user.orgId && u.active)) throw new Error("Usuário inválido.");
    details = `responsável → ${db.users.find((u) => u.id === target)?.name ?? "ninguém"}`;
    await mutate(() => {
      conv.assigneeId = target || null;
    });
  }
  if (status && ["aberta", "pendente", "resolvida"].includes(status)) {
    details = `status → ${status}`;
    await mutate(() => {
      conv.status = status;
    });
  }
  await audit({ orgId: user.orgId, userId: user.id, action: "atendimento.atualizado", entity: "conversa", entityId: convId, details, ip: await clientIp() });
  revalidatePath(`/inbox/${convId}`);
}

/**
 * MODO DEMO: simula a chegada de uma mensagem do cliente passando pelo MESMO processador
 * usado pelo webhook oficial (inclusive detecção de "SAIR" para descadastro).
 */
export async function simulateInboundAction(formData: FormData) {
  const user = await authorize("inbox:reply");
  const convId = String(formData.get("conversationId"));
  const text = String(formData.get("text") ?? "").trim().slice(0, 1000) || "Olá! Gostaria de mais informações.";
  const { db, conv } = await loadConv(user, convId);
  const client = db.clients.find((c) => c.id === conv.clientId)!;
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ id: "DEMO", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "550000000000", phone_number_id: "DEMO" },
      contacts: [{ wa_id: client.phone, profile: { name: client.name } }],
      messages: [{ from: client.phone, id: `wamid.SIMULADO.IN.${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
    } }] }],
  };
  await applyWhatsAppEvents(user.orgId, parseWebhook(payload));
  revalidatePath(`/inbox/${convId}`);
}
