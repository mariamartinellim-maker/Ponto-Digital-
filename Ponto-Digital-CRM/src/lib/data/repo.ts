import "server-only";
import { randomUUID } from "node:crypto";
import { normalizePhone, phoneDedupKey } from "../phone";
import { isOptOutMessage } from "../segmentation";
import type { WaEnvelope } from "../whatsapp/events";
import { getDb, mutate } from "./store";
import type {
  AuditLog,
  Client,
  ConsentSource,
  Conversation,
  Database,
  Message,
  MessageOrigin,
  PublicUser,
} from "./types";

/**
 * Repositório: TODAS as consultas recebem `orgId` e filtram por ele (isolamento de dados).
 * No Supabase, o mesmo isolamento é garantido também por Row Level Security.
 */

export const now = () => new Date().toISOString();

export function publicUser(u: Database["users"][number]): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, sessionVersion, ...rest } = u;
  return rest;
}

export async function scoped(orgId: string) {
  const db = await getDb();
  const by = <T extends { orgId: string }>(rows: T[]) => rows.filter((r) => r.orgId === orgId);
  return {
    users: by(db.users).map(publicUser),
    clients: by(db.clients),
    deals: by(db.deals),
    conversations: by(db.conversations),
    messages: by(db.messages),
    quickReplies: by(db.quickReplies),
    templates: by(db.templates),
    campaigns: by(db.campaigns),
    tasks: by(db.tasks),
    consentEvents: by(db.consentEvents),
    auditLogs: by(db.auditLogs),
    webhookEvents: by(db.webhookEvents),
  };
}

export async function audit(
  entry: Omit<AuditLog, "id" | "at" | "details" | "ip"> & { details?: string; ip?: string | null },
) {
  await mutate((db) => {
    db.auditLogs.unshift({ id: randomUUID(), at: now(), details: "", ip: null, ...entry });
    if (db.auditLogs.length > 5000) db.auditLogs.length = 5000;
  });
}

export function findClientByPhone(db: Database, orgId: string, phone: string) {
  const key = phoneDedupKey(phone);
  return db.clients.find((c) => c.orgId === orgId && phoneDedupKey(c.phone) === key);
}

export function setConsent(
  db: Database,
  client: Client,
  status: "opt_in" | "opt_out",
  source: ConsentSource,
  note: string,
  byUserId: string | null,
) {
  const at = now();
  client.consent = { status, source, at };
  client.updatedAt = at;
  db.consentEvents.unshift({ id: randomUUID(), orgId: client.orgId, clientId: client.id, status, source, note, byUserId, at });
}

function ensureConversation(db: Database, orgId: string, client: Client): Conversation {
  let conv = db.conversations.find((c) => c.orgId === orgId && c.clientId === client.id);
  if (!conv) {
    conv = {
      id: randomUUID(),
      orgId,
      clientId: client.id,
      assigneeId: client.ownerId,
      status: "aberta",
      unread: 0,
      lastMessageAt: now(),
      lastInboundAt: null,
    };
    db.conversations.unshift(conv);
  }
  return conv;
}

export function appendMessage(
  db: Database,
  conv: Conversation,
  msg: { direction: "in" | "out"; origin: MessageOrigin; body: string; status: Message["status"]; waMessageId: string | null; authorId: string | null; createdAt?: string },
) {
  const m: Message = { id: randomUUID(), orgId: conv.orgId, conversationId: conv.id, createdAt: now(), ...msg };
  db.messages.push(m);
  if (m.createdAt >= conv.lastMessageAt) conv.lastMessageAt = m.createdAt;
  if (m.direction === "in" && m.origin !== "historico") {
    conv.lastInboundAt = m.createdAt;
    conv.unread += 1;
    if (conv.status === "resolvida") conv.status = "aberta";
  }
  const client = db.clients.find((c) => c.id === conv.clientId);
  if (client && (!client.lastContactAt || client.lastContactAt < m.createdAt)) client.lastContactAt = m.createdAt;
  return m;
}

function clientForPhone(db: Database, orgId: string, rawPhone: string, name: string | null) {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  let client = findClientByPhone(db, orgId, phone);
  if (!client) {
    const t = now();
    client = {
      id: randomUUID(),
      orgId,
      name: name || `Contato ${phone.slice(-4)}`,
      phone,
      email: "",
      city: "",
      services: [],
      tags: ["WhatsApp"],
      notes: "Criado automaticamente a partir de mensagem do WhatsApp.",
      ownerId: null,
      consent: { status: "desconhecido", source: null, at: null },
      createdAt: t,
      updatedAt: t,
      lastContactAt: null,
    };
    db.clients.unshift(client);
    db.deals.unshift({
      id: randomUUID(),
      orgId,
      clientId: client.id,
      title: "Novo contato via WhatsApp",
      valueCents: 0,
      stage: "novo_lead",
      ownerId: null,
      createdAt: t,
      updatedAt: t,
      closedAt: null,
    });
  }
  return client;
}

const STATUS_MAP = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" } as const;
const STATUS_RANK: Record<string, number> = { simulada: 0, enviada: 1, entregue: 2, lida: 3, respondeu: 4, falhou: 5, descadastrou: 6 };

/** Aplica eventos de webhook (idempotente por ID de mensagem). */
export async function applyWhatsAppEvents(orgId: string, envelopes: WaEnvelope[]) {
  return mutate((db) => {
    const processed = new Set(db.processedWaIds);
    const stats = { inbound: 0, statuses: 0, echoes: 0, history: 0, contacts: 0, optOuts: 0, duplicates: 0 };
    const markProcessed = (id: string) => {
      processed.add(id);
      db.processedWaIds.push(id);
    };

    for (const env of envelopes) {
      for (const ev of env.events) {
        const ts = "timestamp" in ev && ev.timestamp ? new Date(ev.timestamp * 1000).toISOString() : now();
        if (ev.kind === "status") {
          stats.statuses++;
          const msg = db.messages.find((m) => m.orgId === orgId && m.waMessageId === ev.waMessageId);
          if (msg) msg.status = STATUS_MAP[ev.status];
          for (const camp of db.campaigns.filter((c) => c.orgId === orgId)) {
            const r = camp.recipients.find((x) => x.waMessageId === ev.waMessageId);
            const next = STATUS_MAP[ev.status];
            if (r && (STATUS_RANK[next] ?? 0) > (STATUS_RANK[r.status] ?? 0) && r.status !== "respondeu") r.status = next;
          }
          continue;
        }
        if (ev.kind === "contact_sync") {
          stats.contacts++;
          if (ev.action === "add" && ev.phone) clientForPhone(db, orgId, ev.phone, ev.name);
          continue;
        }
        if (processed.has(ev.waMessageId)) {
          stats.duplicates++;
          continue;
        }
        markProcessed(ev.waMessageId);

        if (ev.kind === "inbound") {
          stats.inbound++;
          const client = clientForPhone(db, orgId, ev.from, ev.profileName);
          const conv = ensureConversation(db, orgId, client);
          appendMessage(db, conv, { direction: "in", origin: "cliente", body: ev.text, status: "recebida", waMessageId: ev.waMessageId, authorId: null, createdAt: ts });
          // Resposta a uma campanha executada nos últimos 7 dias
          const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
          for (const camp of db.campaigns.filter((c) => c.orgId === orgId && c.status === "concluida" && (c.executedAt ?? "") >= weekAgo)) {
            const r = camp.recipients.find((x) => x.clientId === client.id);
            if (r && r.status !== "descadastrou") r.status = "respondeu";
          }
          if (isOptOutMessage(ev.text)) {
            stats.optOuts++;
            setConsent(db, client, "opt_out", "palavra_chave", `Cliente enviou "${ev.text}"`, null);
            for (const camp of db.campaigns.filter((c) => c.orgId === orgId)) {
              const r = camp.recipients.find((x) => x.clientId === client.id);
              if (r) r.status = "descadastrou";
            }
            appendMessage(db, conv, { direction: "out", origin: "sistema", body: "Contato descadastrado das campanhas (pedido de opt-out).", status: "simulada", waMessageId: null, authorId: null });
          }
        } else if (ev.kind === "echo") {
          stats.echoes++;
          const client = clientForPhone(db, orgId, ev.to, null);
          const conv = ensureConversation(db, orgId, client);
          appendMessage(db, conv, { direction: "out", origin: "app_business", body: ev.text, status: "enviada", waMessageId: ev.waMessageId, authorId: null, createdAt: ts });
        } else if (ev.kind === "history") {
          stats.history++;
          const client = clientForPhone(db, orgId, ev.contact, null);
          const conv = ensureConversation(db, orgId, client);
          appendMessage(db, conv, { direction: ev.direction, origin: "historico", body: ev.text, status: ev.direction === "in" ? "recebida" : "entregue", waMessageId: ev.waMessageId, authorId: null, createdAt: ts });
        }
      }
      db.webhookEvents.unshift({
        id: randomUUID(),
        orgId,
        field: env.field,
        summary: `${env.events.length} evento(s)`,
        receivedAt: now(),
      });
    }
    if (db.processedWaIds.length > 20000) db.processedWaIds.splice(0, db.processedWaIds.length - 20000);
    if (db.webhookEvents.length > 500) db.webhookEvents.length = 500;
    db.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return stats;
  });
}
