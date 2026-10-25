"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize, clientIp, type SessionUser } from "@/lib/auth/session";
import { appendMessage, applyWhatsAppEvents, audit, now, scoped } from "@/lib/data/repo";
import { getDb, mutate } from "@/lib/data/store";
import type { Conversation, ConversationStatus, Database } from "@/lib/data/types";
import { canSeeConversation, windowOpen } from "@/lib/inbox";
import { can } from "@/lib/permissions";
import { renderTemplate } from "@/lib/segmentation";
import * as sb from "@/lib/supabase/ops";
import { isSupabase } from "@/lib/supabase/server";
import { sendWhatsApp } from "@/lib/whatsapp/client";
import { parseWebhook } from "@/lib/whatsapp/events";

async function loadConv(user: SessionUser, id: string): Promise<{ db: Database; conv: Conversation }> {
  const db = await getDb();
  const conv = db.conversations.find((c) => c.id === id && c.orgId === user.orgId);
  if (!conv || !canSeeConversation(user, conv)) throw new Error("Conversa não encontrada.");
  return { db, conv };
}

/** Conversa + dados do cliente necessários para enviar, nos dois modos. */
async function loadTarget(user: SessionUser, convId: string) {
  if (isSupabase()) {
    const r = await sb.loadConversation(convId);
    if (!r || !canSeeConversation(user, r.conv)) throw new Error("Conversa não encontrada.");
    return { conv: r.conv, phone: r.client.phone, consent: r.client.consent };
  }
  const { db, conv } = await loadConv(user, convId);
  const client = db.clients.find((c) => c.id === conv.clientId)!;
  return { conv, phone: client.phone, consent: client.consent.status as string };
}

export async function startConversationAction(formData: FormData) {
  const user = await authorize("inbox:reply");
  const clientId = String(formData.get("clientId"));
  let convId: string;
  if (isSupabase()) {
    const r = await sb.startConversation(user, clientId);
    if (!r.ok) throw new Error(r.error);
    convId = r.data;
  } else {
    convId = await mutate((db) => {
      const client = db.clients.find((c) => c.id === clientId && c.orgId === user.orgId);
      if (!client) throw new Error("Cliente não encontrado.");
      const existing = db.conversations.find((c) => c.clientId === clientId && c.orgId === user.orgId);
      if (existing) return existing.id;
      const conv: Conversation = { id: randomUUID(), orgId: user.orgId, clientId, assigneeId: user.id, status: "aberta", unread: 0, lastMessageAt: now(), lastInboundAt: null };
      db.conversations.unshift(conv);
      return conv.id;
    });
  }
  redirect(`/inbox/${convId}`);
}

export type SendState = { error?: string; ok?: number } | undefined;

/** Grava a mensagem enviada e assume a conversa se ela não tiver responsável. */
async function recordOutgoing(user: SessionUser, conv: Conversation, body: string, simulated: boolean, waMessageId: string) {
  if (isSupabase()) {
    const r = await sb.insertOutgoingMessage(user, conv.id, body, simulated ? "simulada" : "enviada", waMessageId);
    if (!r.ok) return r.error;
    if (!conv.assigneeId || conv.status === "pendente") {
      await sb.updateConversation(conv.id, { assigneeId: conv.assigneeId ?? user.id, status: conv.status === "pendente" ? "aberta" : conv.status });
    }
    return null;
  }
  const db = await getDb();
  const live = db.conversations.find((c) => c.id === conv.id)!;
  await mutate((d) => {
    appendMessage(d, live, { direction: "out", origin: "crm", body, status: simulated ? "simulada" : "enviada", waMessageId, authorId: user.id });
    if (!live.assigneeId) live.assigneeId = user.id;
    if (live.status === "pendente") live.status = "aberta";
  });
  return null;
}

export async function sendMessageAction(_: SendState, formData: FormData): Promise<SendState> {
  const user = await authorize("inbox:reply");
  const convId = String(formData.get("conversationId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Digite uma mensagem." };
  if (body.length > 4096) return { error: "Mensagem muito longa (máx. 4096 caracteres)." };
  const { conv, phone } = await loadTarget(user, convId);

  // Regra da Meta: texto livre somente até 24h após a última mensagem do cliente.
  if (!windowOpen(conv)) {
    return { error: "Fora da janela de 24h. Use um modelo (template) aprovado para retomar a conversa." };
  }
  const result = await sendWhatsApp({ type: "text", to: phone, body });
  if (!result.ok) return { error: `Falha no envio: ${result.error}` };
  const err = await recordOutgoing(user, conv, body, result.simulated, result.waMessageId);
  if (err) return { error: err };
  revalidatePath(`/inbox/${convId}`);
  return { ok: Date.now() };
}

export async function sendTemplateAction(_: SendState, formData: FormData): Promise<SendState> {
  const user = await authorize("inbox:reply");
  const convId = String(formData.get("conversationId"));
  const templateId = String(formData.get("templateId"));
  const vars = formData.getAll("var").map((v) => String(v).trim().slice(0, 200));
  const { conv, phone, consent } = await loadTarget(user, convId);
  const tpl = (await scoped(user.orgId)).templates.find((t) => t.id === templateId);
  if (!tpl || tpl.status !== "APPROVED") return { error: "Selecione um modelo aprovado pela Meta." };
  if (tpl.category === "MARKETING" && consent !== "opt_in") {
    return { error: "Modelos de marketing exigem consentimento (opt-in) do cliente." };
  }
  if (vars.some((v) => !v)) return { error: "Preencha todas as variáveis do modelo." };
  const result = await sendWhatsApp({ type: "template", to: phone, name: tpl.name, language: tpl.language, variables: vars });
  if (!result.ok) return { error: `Falha no envio: ${result.error}` };
  const err = await recordOutgoing(user, conv, renderTemplate(tpl.body, vars), result.simulated, result.waMessageId);
  if (err) return { error: err };
  revalidatePath(`/inbox/${convId}`);
  return { ok: Date.now() };
}

export async function markReadAction(convId: string) {
  const user = await authorize();
  const { conv } = await loadTarget(user, convId);
  if (conv.unread === 0) return;
  if (isSupabase()) await sb.updateConversation(convId, { unread: 0 });
  else {
    const { conv: live } = await loadConv(user, convId);
    await mutate(() => {
      live.unread = 0;
    });
  }
  revalidatePath("/inbox", "layout");
}

export async function updateConversationAction(formData: FormData) {
  const user = await authorize("inbox:reply");
  const convId = String(formData.get("conversationId"));
  const { conv } = await loadTarget(user, convId);
  const users = (await scoped(user.orgId)).users;
  const status = formData.get("status") as ConversationStatus | null;
  const assignee = formData.get("assigneeId");
  let details = "";
  const patch: { assigneeId?: string | null; status?: ConversationStatus } = {};
  if (assignee !== null) {
    const target = String(assignee);
    const selfAssign = target === user.id && !conv.assigneeId;
    if (!selfAssign && !can(user.role, "inbox:assign")) throw new Error("Sem permissão para transferir conversas.");
    if (target && !users.some((u) => u.id === target && u.active)) throw new Error("Usuário inválido.");
    details = `responsável → ${users.find((u) => u.id === target)?.name ?? "ninguém"}`;
    patch.assigneeId = target || null;
  }
  if (status && ["aberta", "pendente", "resolvida"].includes(status)) {
    details = `status → ${status}`;
    patch.status = status;
  }
  if (isSupabase()) {
    const r = await sb.updateConversation(convId, patch);
    if (!r.ok) throw new Error(r.error);
  } else {
    const { conv: live } = await loadConv(user, convId);
    await mutate(() => {
      if (patch.assigneeId !== undefined) live.assigneeId = patch.assigneeId;
      if (patch.status) live.status = patch.status;
    });
  }
  await audit({ orgId: user.orgId, userId: user.id, action: "atendimento.atualizado", entity: "conversa", entityId: convId, details, ip: await clientIp() });
  revalidatePath(`/inbox/${convId}`);
}

/**
 * MODO DEMO: simula a chegada de uma mensagem do cliente passando pelo MESMO processador
 * usado pelo webhook oficial (inclusive detecção de "SAIR" para descadastro).
 * No Supabase, mensagens recebidas só entram pelo webhook oficial (servidor).
 */
export async function simulateInboundAction(formData: FormData) {
  const user = await authorize("inbox:reply");
  if (isSupabase()) throw new Error("A simulação de mensagens recebidas existe apenas no modo demonstração.");
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
