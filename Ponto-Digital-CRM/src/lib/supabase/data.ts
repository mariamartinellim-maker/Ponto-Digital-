import "server-only";
import type {
  AuditLog,
  Campaign,
  CampaignRecipient,
  Client,
  ConsentEvent,
  Conversation,
  Deal,
  Message,
  MessageTemplate,
  PublicUser,
  QuickReply,
  Task,
  WebhookEventLog,
} from "../data/types";
import { supabaseServer } from "./server";

/*
 * Leitura dos dados da organização no Supabase, convertidos para os mesmos tipos
 * usados pelas telas (as páginas não mudam). O RLS garante que só chegam dados
 * da organização — e do que o perfil do usuário pode ver.
 */

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => Number(v ?? 0);
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

const PAGE = 1000;
const MAX_ROWS = 20_000;

/** Lê uma tabela inteira em páginas (o Supabase devolve no máximo 1000 linhas por vez). */
async function fetchAll(table: string, columns: string, order: string, ascending = true): Promise<Row[]> {
  const sb = await supabaseServer();
  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await sb.from(table).select(columns).order(order, { ascending }).range(from, from + PAGE - 1);
    if (error) throw new Error(`Falha ao ler ${table} no Supabase: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function fetchLatest(table: string, columns: string, order: string, limit: number): Promise<Row[]> {
  const sb = await supabaseServer();
  const { data, error } = await sb.from(table).select(columns).order(order, { ascending: false }).limit(limit);
  if (error) throw new Error(`Falha ao ler ${table} no Supabase: ${error.message}`);
  return (data ?? []) as unknown as Row[];
}

const toUser = (r: Row): PublicUser => ({
  id: str(r.id),
  orgId: str(r.org_id),
  name: str(r.name),
  email: str(r.email),
  role: r.role as PublicUser["role"],
  active: Boolean(r.active),
  createdAt: str(r.created_at),
  lastLoginAt: strOrNull(r.last_login_at),
});

export const toClient = (r: Row): Client => ({
  id: str(r.id),
  orgId: str(r.org_id),
  name: str(r.name),
  phone: str(r.phone),
  email: str(r.email),
  city: str(r.city),
  services: arr(r.services),
  tags: arr(r.tags),
  notes: str(r.notes),
  ownerId: strOrNull(r.owner_id),
  consent: {
    status: r.consent_status as Client["consent"]["status"],
    source: (r.consent_source ?? null) as Client["consent"]["source"],
    at: strOrNull(r.consent_at),
  },
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  lastContactAt: strOrNull(r.last_contact_at),
});

const toDeal = (r: Row): Deal => ({
  id: str(r.id),
  orgId: str(r.org_id),
  clientId: str(r.client_id),
  title: str(r.title),
  valueCents: num(r.value_cents),
  stage: r.stage as Deal["stage"],
  ownerId: strOrNull(r.owner_id),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  closedAt: strOrNull(r.closed_at),
});

export const toConversation = (r: Row): Conversation => ({
  id: str(r.id),
  orgId: str(r.org_id),
  clientId: str(r.client_id),
  assigneeId: strOrNull(r.assignee_id),
  status: r.status as Conversation["status"],
  unread: num(r.unread),
  lastMessageAt: str(r.last_message_at),
  lastInboundAt: strOrNull(r.last_inbound_at),
});

const toMessage = (r: Row): Message => ({
  id: str(r.id),
  orgId: str(r.org_id),
  conversationId: str(r.conversation_id),
  direction: r.direction as Message["direction"],
  origin: r.origin as Message["origin"],
  body: str(r.body),
  status: r.status as Message["status"],
  waMessageId: strOrNull(r.wa_message_id),
  authorId: strOrNull(r.author_id),
  createdAt: str(r.created_at),
});

const toTemplate = (r: Row): MessageTemplate => ({
  id: str(r.id),
  orgId: str(r.org_id),
  name: str(r.name),
  category: r.category as MessageTemplate["category"],
  language: str(r.language),
  body: str(r.body),
  status: r.status as MessageTemplate["status"],
  metaTemplateId: strOrNull(r.meta_template_id),
  createdAt: str(r.created_at),
});

/** Mesmo formato de `scoped()` do modo demonstração. */
export async function loadOrgData(orgId: string) {
  const [profiles, clients, deals, conversations, messages, quickReplies, templates, campaigns, recipients, tasks, consents, audits, webhooks] =
    await Promise.all([
      fetchAll("profiles", "id,org_id,name,email,role,active,created_at,last_login_at", "name"),
      fetchAll("clients", "*", "name"),
      fetchAll("deals", "*", "updated_at", false),
      fetchAll("conversations", "*", "last_message_at", false),
      // Histórico recente (as conversas mais antigas continuam no banco)
      fetchLatest("messages", "*", "created_at", 5000),
      fetchAll("quick_replies", "*", "shortcut"),
      fetchAll("message_templates", "*", "created_at"),
      fetchAll("campaigns", "*", "created_at", false),
      fetchAll("campaign_recipients", "*", "campaign_id"),
      fetchAll("tasks", "*", "due_at"),
      fetchLatest("consent_events", "*", "at", 5000),
      fetchLatest("audit_logs", "id,org_id,user_id,action,entity,entity_id,details,ip,at", "at", 500), // vazio para quem não é admin (RLS)
      fetchLatest("webhook_events", "*", "received_at", 50),
    ]);

  const byCampaign = new Map<string, CampaignRecipient[]>();
  for (const r of recipients) {
    const list = byCampaign.get(str(r.campaign_id)) ?? [];
    list.push({ clientId: str(r.client_id), status: r.status as CampaignRecipient["status"], waMessageId: strOrNull(r.wa_message_id) });
    byCampaign.set(str(r.campaign_id), list);
  }
  const segment = (v: unknown) => {
    const s = (v ?? {}) as Record<string, unknown>;
    return { cities: arr(s.cities), services: arr(s.services), stages: arr(s.stages) as Campaign["segment"]["stages"], tags: arr(s.tags) };
  };

  return {
    users: profiles.map(toUser).filter((u) => u.orgId === orgId),
    clients: clients.map(toClient),
    deals: deals.map(toDeal),
    conversations: conversations.map(toConversation),
    messages: messages.map(toMessage).reverse(),
    quickReplies: quickReplies.map((r): QuickReply => ({ id: str(r.id), orgId: str(r.org_id), shortcut: str(r.shortcut), title: str(r.title), body: str(r.body) })),
    templates: templates.map(toTemplate),
    campaigns: campaigns.map(
      (r): Campaign => ({
        id: str(r.id),
        orgId: str(r.org_id),
        name: str(r.name),
        templateId: str(r.template_id),
        segment: segment(r.segment),
        mode: r.mode === "live" ? "live" : "simulacao",
        status: r.status as Campaign["status"],
        createdBy: str(r.created_by),
        createdAt: str(r.created_at),
        executedAt: strOrNull(r.executed_at),
        excludedNoConsent: num(r.excluded_no_consent),
        excludedOptOut: num(r.excluded_opt_out),
        recipients: byCampaign.get(str(r.id)) ?? [],
      }),
    ),
    tasks: tasks.map(
      (r): Task => ({
        id: str(r.id),
        orgId: str(r.org_id),
        title: str(r.title),
        type: r.type as Task["type"],
        clientId: strOrNull(r.client_id),
        assigneeId: strOrNull(r.assignee_id),
        dueAt: str(r.due_at),
        done: Boolean(r.done),
        notes: str(r.notes),
        createdAt: str(r.created_at),
      }),
    ),
    consentEvents: consents.map(
      (r): ConsentEvent => ({
        id: str(r.id),
        orgId: str(r.org_id),
        clientId: str(r.client_id),
        status: r.status as ConsentEvent["status"],
        source: r.source as ConsentEvent["source"],
        note: str(r.note),
        byUserId: strOrNull(r.by_user_id),
        at: str(r.at),
      }),
    ),
    auditLogs: audits.map(
      (r): AuditLog => ({
        id: str(r.id),
        orgId: str(r.org_id),
        userId: strOrNull(r.user_id),
        action: str(r.action),
        entity: str(r.entity),
        entityId: strOrNull(r.entity_id),
        details: str(r.details),
        ip: strOrNull(r.ip),
        at: str(r.at),
      }),
    ),
    webhookEvents: webhooks.map(
      (r): WebhookEventLog => ({ id: str(r.id), orgId: str(r.org_id), field: str(r.field), summary: str(r.summary), receivedAt: str(r.received_at) }),
    ),
  };
}
