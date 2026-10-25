import "server-only";
import type { SessionUser } from "../auth/session";
import type { ImportRow } from "../csv";
import type { ConsentSource, ConversationStatus, MessageMedia, MessageStatus, Stage } from "../data/types";
import { phoneDedupKey } from "../phone";
import { toConversation } from "./data";
import { dbError, supabaseServer } from "./server";

/*
 * Gravações no Supabase com a sessão do usuário. O banco (RLS, privilégios por coluna,
 * gatilhos) é a última linha de defesa; as regras de negócio continuam nas actions.
 */

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });

export interface ClientInput {
  name: string;
  phone: string;
  email: string;
  city: string;
  services: string[];
  tags: string[];
  notes: string;
  ownerId: string | null;
}

export async function findClientByPhone(phone: string) {
  const sb = await supabaseServer();
  const { data } = await sb.from("clients").select("id,name").eq("phone_key", phoneDedupKey(phone)).maybeSingle();
  return data as { id: string; name: string } | null;
}

export async function createClient(user: SessionUser, c: ClientInput, consent: boolean): Promise<Result<string>> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("clients")
    .insert({
      org_id: user.orgId,
      name: c.name,
      phone: c.phone,
      email: c.email,
      city: c.city,
      services: c.services,
      tags: c.tags,
      notes: c.notes,
      owner_id: c.ownerId ?? user.id,
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.code === "23505" ? "Já existe um cliente com este telefone." : dbError(error));
  const id = data.id as string;
  await sb.from("deals").insert({ org_id: user.orgId, client_id: id, title: "Nova oportunidade", owner_id: c.ownerId ?? user.id });
  if (consent) await addConsent(user, id, "opt_in", "manual", "Consentimento registrado no cadastro.");
  return ok(id);
}

export async function updateClient(user: SessionUser, id: string, c: ClientInput): Promise<Result> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("clients")
    .update({ name: c.name, phone: c.phone, email: c.email, city: c.city, services: c.services, tags: c.tags, notes: c.notes, owner_id: c.ownerId })
    .eq("id", id)
    .select("id");
  if (error) return fail(error.code === "23505" ? "Já existe um cliente com este telefone." : dbError(error));
  return data?.length ? ok(undefined) : fail("Cliente não encontrado.");
}

/** O status de consentimento do cliente é atualizado pelo banco a partir deste registro. */
export async function addConsent(user: SessionUser, clientId: string, status: "opt_in" | "opt_out", source: ConsentSource, note: string): Promise<Result> {
  const sb = await supabaseServer();
  const { error } = await sb
    .from("consent_events")
    .insert({ org_id: user.orgId, client_id: clientId, status, source, note: note.slice(0, 500), by_user_id: user.id });
  return error ? fail(dbError(error)) : ok(undefined);
}

export async function importClients(user: SessionUser, rows: ImportRow[], consentConfirmed: boolean): Promise<Result<number>> {
  const sb = await supabaseServer();
  let imported = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await sb
      .from("clients")
      .insert(
        chunk.map((r) => ({
          org_id: user.orgId,
          name: r.name,
          phone: r.phone,
          email: r.email,
          city: r.city,
          services: r.services,
          tags: ["Importado"],
          notes: r.notes,
        })),
      )
      .select("id,phone");
    if (error || !data) {
      return fail(
        (error?.code === "23505" ? "Um dos telefones já foi cadastrado enquanto você importava. " : dbError(error) + " ") +
          `${imported} contato(s) importado(s) antes do erro.`,
      );
    }
    imported += data.length;
    const idByPhone = new Map(data.map((d) => [String(d.phone), String(d.id)]));
    await sb.from("deals").insert(data.map((d) => ({ org_id: user.orgId, client_id: d.id, title: "Lead importado" })));
    if (consentConfirmed) {
      const consents = chunk
        .filter((r) => r.consent && idByPhone.has(r.phone))
        .map((r) => ({
          org_id: user.orgId,
          client_id: idByPhone.get(r.phone),
          status: "opt_in",
          source: "importacao",
          note: "Consentimento informado no arquivo importado.",
          by_user_id: user.id,
        }));
      if (consents.length) await sb.from("consent_events").insert(consents);
    }
  }
  return ok(imported);
}

// ---------------------------------------------------------------------------
// Funil
// ---------------------------------------------------------------------------
export async function moveDeal(dealId: string, stage: Stage): Promise<Result<Stage>> {
  const sb = await supabaseServer();
  const { data: prev } = await sb.from("deals").select("stage").eq("id", dealId).maybeSingle();
  if (!prev) return fail("Oportunidade não encontrada.");
  const closed = stage === "fechado" || stage === "perdido";
  const { error } = await sb.from("deals").update({ stage, closed_at: closed ? new Date().toISOString() : null }).eq("id", dealId);
  return error ? fail(dbError(error)) : ok(prev.stage as Stage);
}

export async function saveDeal(user: SessionUser, d: { id?: string; clientId: string; title: string; valueCents: number }): Promise<Result> {
  const sb = await supabaseServer();
  const { data, error } = d.id
    ? await sb.from("deals").update({ title: d.title, value_cents: d.valueCents }).eq("id", d.id).select("id")
    : await sb
        .from("deals")
        .insert({ org_id: user.orgId, client_id: d.clientId, title: d.title, value_cents: d.valueCents, owner_id: user.id })
        .select("id");
  if (error) return fail(dbError(error));
  return data?.length ? ok(undefined) : fail("Registro não encontrado.");
}

// ---------------------------------------------------------------------------
// Atendimento
// ---------------------------------------------------------------------------

/** Conversa + telefone/consentimento do cliente (o RLS já filtra o que o usuário pode ver). */
export async function loadConversation(convId: string) {
  const sb = await supabaseServer();
  const { data: c } = await sb.from("conversations").select("*").eq("id", convId).maybeSingle();
  if (!c) return null;
  const { data: client } = await sb.from("clients").select("id,phone,consent_status").eq("id", c.client_id).maybeSingle();
  if (!client) return null;
  return { conv: toConversation(c), client: { id: String(client.id), phone: String(client.phone), consent: String(client.consent_status) } };
}

export async function startConversation(user: SessionUser, clientId: string): Promise<Result<string>> {
  const sb = await supabaseServer();
  const { data: existing } = await sb.from("conversations").select("id").eq("client_id", clientId).maybeSingle();
  if (existing) return ok(String(existing.id));
  const { data, error } = await sb
    .from("conversations")
    .insert({ org_id: user.orgId, client_id: clientId, assignee_id: user.id })
    .select("id")
    .single();
  if (error || !data) {
    // Já existe, mas atribuída a outra pessoa (o RLS esconde do atendente)
    return fail(error?.code === "23505" ? "Este cliente já tem uma conversa com outro responsável." : dbError(error));
  }
  return ok(String(data.id));
}

/** Grava a mensagem enviada; o banco atualiza a conversa (última mensagem) por gatilho. */
export async function insertOutgoingMessage(
  user: SessionUser,
  convId: string,
  body: string,
  status: Extract<MessageStatus, "simulada" | "enviada">,
  waMessageId: string,
  extra: { media?: MessageMedia | null; aiAssisted?: boolean; origin?: "crm" | "campanha" } = {},
): Promise<Result> {
  const sb = await supabaseServer();
  const { error } = await sb.from("messages").insert({
    org_id: user.orgId,
    conversation_id: convId,
    direction: "out",
    origin: extra.origin ?? "crm",
    body,
    status,
    wa_message_id: waMessageId,
    author_id: user.id,
    ...(extra.media ? { media: extra.media } : {}),
    ...(extra.aiAssisted ? { ai_assisted: true } : {}),
  });
  return error ? fail(dbError(error)) : ok(undefined);
}

export async function updateConversation(
  convId: string,
  patch: { assigneeId?: string | null; status?: ConversationStatus; unread?: number },
): Promise<Result> {
  const sb = await supabaseServer();
  const row: Record<string, unknown> = {};
  if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.unread !== undefined) row.unread = patch.unread;
  const { data, error } = await sb.from("conversations").update(row).eq("id", convId).select("id");
  if (error) return fail(dbError(error));
  return data?.length ? ok(undefined) : fail("Você não tem permissão para alterar esta conversa.");
}
