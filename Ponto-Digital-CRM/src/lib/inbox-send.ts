import "server-only";
import type { SessionUser } from "./auth/session";
import { appendMessage } from "./data/repo";
import { getDb, mutate } from "./data/store";
import type { Conversation, Database, MessageMedia } from "./data/types";
import { canSeeConversation } from "./inbox";
import * as sb from "./supabase/ops";
import { isSupabase } from "./supabase/server";

export async function loadConv(user: SessionUser, id: string): Promise<{ db: Database; conv: Conversation }> {
  const db = await getDb();
  const conv = db.conversations.find((c) => c.id === id && c.orgId === user.orgId);
  if (!conv || !canSeeConversation(user, conv)) throw new Error("Conversa não encontrada.");
  return { db, conv };
}

/** Conversa + dados do cliente necessários para enviar, nos dois modos. */
export async function loadTarget(user: SessionUser, convId: string) {
  if (isSupabase()) {
    const r = await sb.loadConversation(convId);
    if (!r || !canSeeConversation(user, r.conv)) throw new Error("Conversa não encontrada.");
    return { conv: r.conv, phone: r.client.phone, consent: r.client.consent };
  }
  const { db, conv } = await loadConv(user, convId);
  const client = db.clients.find((c) => c.id === conv.clientId)!;
  return { conv, phone: client.phone, consent: client.consent.status as string };
}

/** Grava a mensagem enviada e assume a conversa se ela não tiver responsável. */
export async function recordOutgoing(
  user: SessionUser,
  conv: Conversation,
  body: string,
  simulated: boolean,
  waMessageId: string,
  extra: { media?: MessageMedia | null; aiAssisted?: boolean } = {},
) {
  if (isSupabase()) {
    const r = await sb.insertOutgoingMessage(user, conv.id, body, simulated ? "simulada" : "enviada", waMessageId, extra);
    if (!r.ok) return r.error;
    if (!conv.assigneeId || conv.status === "pendente") {
      await sb.updateConversation(conv.id, { assigneeId: conv.assigneeId ?? user.id, status: conv.status === "pendente" ? "aberta" : conv.status });
    }
    return null;
  }
  const db = await getDb();
  const live = db.conversations.find((c) => c.id === conv.id)!;
  await mutate((d) => {
    appendMessage(d, live, { direction: "out", origin: "crm", body, status: simulated ? "simulada" : "enviada", waMessageId, authorId: user.id, ...extra });
    if (!live.assigneeId) live.assigneeId = user.id;
    if (live.status === "pendente") live.status = "aberta";
  });
  return null;
}

