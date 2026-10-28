import "server-only";
import { env } from "../env";
import { normalizePhone } from "../phone";
import { isOptOutMessage } from "../segmentation";
import { supabaseAdmin } from "../supabase/admin";
import type { WaEnvelope, WaEvent } from "./events";

/** Evento no formato aceito por public.wa_ingest_event (ver a migração da Fase 2). */
export function toDbEvent(ev: WaEvent): Record<string, unknown> | null {
  const phone = (raw: string) => normalizePhone(raw) ?? raw;
  switch (ev.kind) {
    case "inbound":
      return {
        kind: "inbound",
        waMessageId: ev.waMessageId,
        phone: phone(ev.from),
        name: ev.profileName,
        text: ev.text,
        timestamp: ev.timestamp,
        media: ev.media,
        optOut: isOptOutMessage(ev.text),
      };
    case "echo":
      return { kind: "echo", waMessageId: ev.waMessageId, phone: phone(ev.to), text: ev.text, timestamp: ev.timestamp, media: ev.media };
    case "history":
      return {
        kind: "history",
        waMessageId: ev.waMessageId,
        phone: phone(ev.contact),
        direction: ev.direction,
        text: ev.text,
        timestamp: ev.timestamp,
        media: ev.media,
      };
    case "status":
      return { kind: "status", waMessageId: ev.waMessageId, status: ev.status, error: ev.error };
    case "contact_sync":
      return { kind: "contact_sync", phone: phone(ev.phone), name: ev.name, action: ev.action };
    case "template_status":
      return { kind: "template_status", name: ev.name, language: ev.language, status: ev.status, metaTemplateId: ev.metaTemplateId };
    default:
      return null;
  }
}

type OrgMap = { byPhone: Map<string, string>; byWaba: Map<string, string> };

async function loadOrgMap(): Promise<OrgMap> {
  const db = supabaseAdmin();
  const [{ data: orgs }, { data: accounts }] = await Promise.all([
    db.from("organizations").select("id,wa_phone_number_id").not("wa_phone_number_id", "is", null),
    db.from("whatsapp_accounts").select("org_id,phone_number_id,waba_id"),
  ]);
  const map: OrgMap = { byPhone: new Map(), byWaba: new Map() };
  for (const o of orgs ?? []) map.byPhone.set(String(o.wa_phone_number_id), String(o.id));
  for (const a of accounts ?? []) {
    map.byPhone.set(String(a.phone_number_id), String(a.org_id));
    map.byWaba.set(String(a.waba_id), String(a.org_id));
  }
  // Conta configurada pelas variáveis do servidor: o WABA pertence à organização do número.
  const e = env();
  if (e.WHATSAPP_WABA_ID && e.WHATSAPP_PHONE_NUMBER_ID && map.byPhone.has(e.WHATSAPP_PHONE_NUMBER_ID)) {
    map.byWaba.set(e.WHATSAPP_WABA_ID, map.byPhone.get(e.WHATSAPP_PHONE_NUMBER_ID)!);
  }
  return map;
}

/** Organização dona de cada envelope (pelo número ou pela conta WhatsApp Business). */
export async function orgResolver(): Promise<(envl: WaEnvelope) => string | null> {
  const map = await loadOrgMap();
  return (envl) => (envl.phoneNumberId && map.byPhone.get(envl.phoneNumberId)) || (!envl.phoneNumberId && envl.wabaId && map.byWaba.get(envl.wabaId)) || null;
}

export interface IngestStats {
  [k: string]: number;
}

/**
 * Grava os eventos do webhook (já com assinatura validada) no Supabase.
 * Números não vinculados a nenhuma organização são ignorados (e registrados), nunca gravados "no escuro".
 */
export async function ingestSupabase(envelopes: WaEnvelope[]): Promise<IngestStats> {
  const db = supabaseAdmin();
  const map = await loadOrgMap();
  const stats: IngestStats = {};
  const add = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

  for (const envl of envelopes) {
    const orgId =
      (envl.phoneNumberId && map.byPhone.get(envl.phoneNumberId)) || (!envl.phoneNumberId && envl.wabaId && map.byWaba.get(envl.wabaId)) || null;
    if (!orgId) {
      add("ignorados_numero_nao_vinculado", envl.events.length);
      console.warn(`[webhook] evento de número não vinculado ignorado (campo ${envl.field})`);
      continue;
    }

    const events = envl.events.map(toDbEvent).filter((e): e is Record<string, unknown> => e !== null);
    for (let i = 0; i < events.length; i += 500) {
      const { data, error } = await db.rpc("wa_ingest_batch", { p_org: orgId, p_events: events.slice(i, i + 500) });
      if (error) {
        console.error("[webhook] falha ao gravar eventos:", error.code, error.message);
        throw new Error("Falha ao gravar eventos"); // 500 → a Meta reenvia; a gravação é idempotente
      }
      for (const [k, v] of Object.entries((data ?? {}) as Record<string, number>)) add(k, v);
    }

    // Andamento da sincronização de histórico (coexistência)
    const progress = envl.events.filter((e) => e.kind === "history_progress");
    if (progress.length) {
      const declined = progress.some((p) => p.kind === "history_progress" && p.declined);
      const done = progress.some((p) => p.kind === "history_progress" && p.progress === 100);
      await db
        .from("whatsapp_accounts")
        .update({ history_status: declined ? "recusado" : done ? "concluido" : "recebendo", updated_at: new Date().toISOString() })
        .eq("org_id", orgId);
    }

    await db.from("webhook_events").insert({
      org_id: orgId,
      field: envl.field.slice(0, 60),
      phone_number_id: envl.phoneNumberId,
      summary: `${envl.events.length} evento(s)`,
    });
  }
  return stats;
}
