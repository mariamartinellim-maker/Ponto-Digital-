/**
 * Normalização dos webhooks da WhatsApp Cloud API (oficial) em eventos internos.
 *
 * Campos (fields) tratados:
 *  - messages            → mensagens recebidas de clientes e atualizações de status
 *  - smb_message_echoes  → coexistência: mensagens enviadas pelo App WhatsApp Business
 *  - history             → coexistência: sincronização do histórico (quando autorizada no onboarding)
 *  - smb_app_state_sync  → coexistência: contatos do App WhatsApp Business
 *  - message_template_status_update → resultado da análise de modelos pela Meta
 *
 * Formatos conforme documentação pública da Meta; validar com payloads reais na etapa de integração.
 */

/** Referência de mídia da Meta (o arquivo fica na Meta; o CRM baixa sob demanda). */
export interface WaMedia {
  type: "image" | "audio" | "video" | "document" | "sticker";
  /** Ausente em mídias antigas do histórico sincronizado. */
  id?: string;
  mime?: string;
  filename?: string;
  caption?: string;
  voice?: boolean;
  /** Arquivo baixado para a biblioteca do CRM (WhatsApp Web experimental). */
  assetId?: string;
}

export type WaEvent =
  | { kind: "inbound"; waMessageId: string; from: string; profileName: string | null; text: string; timestamp: number; media: WaMedia | null; fromAd?: boolean }
  | { kind: "status"; waMessageId: string; status: "sent" | "delivered" | "read" | "failed"; recipient: string; timestamp: number; error: string | null }
  | { kind: "echo"; waMessageId: string; to: string; text: string; timestamp: number; media: WaMedia | null }
  | { kind: "history"; waMessageId: string; contact: string; direction: "in" | "out"; text: string; timestamp: number; media: WaMedia | null }
  | { kind: "history_progress"; declined: boolean; progress: number | null; phase: number | null }
  | { kind: "contact_sync"; phone: string; name: string | null; action: "add" | "remove" }
  | { kind: "template_status"; name: string; language: string; status: "APPROVED" | "PENDING" | "REJECTED"; metaTemplateId: string; reason: string };

export interface WaEnvelope {
  /** ID da conta WhatsApp Business (entry.id) — usado nos eventos sem número (ex.: modelos). */
  wabaId?: string | null;
  phoneNumberId: string | null;
  displayPhone: string | null;
  field: string;
  events: WaEvent[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const digits = (v: unknown) => str(v).replace(/\D/g, "");

const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"] as const;
const MEDIA_LABEL: Record<string, string> = {
  image: "imagem",
  audio: "áudio",
  video: "vídeo",
  document: "documento",
  sticker: "figurinha",
  location: "localização",
  contacts: "contato",
};

function messageMedia(m: Obj): WaMedia | null {
  const type = str(m.type);
  if (!(MEDIA_TYPES as readonly string[]).includes(type) || !isObj(m[type])) return null;
  const o = m[type] as Obj;
  const media: WaMedia = { type: type as WaMedia["type"] };
  if (str(o.id)) media.id = str(o.id).slice(0, 100);
  if (str(o.mime_type)) media.mime = str(o.mime_type).slice(0, 100);
  if (str(o.filename)) media.filename = str(o.filename).slice(0, 200);
  if (str(o.caption)) media.caption = str(o.caption).slice(0, 1024);
  if (o.voice === true) media.voice = true;
  return media;
}

function messageText(m: Obj): string {
  const type = str(m.type);
  if (type === "text" && isObj(m.text)) return str(m.text.body);
  if (type === "button" && isObj(m.button)) return str(m.button.text);
  if (type === "interactive" && isObj(m.interactive)) {
    const i = m.interactive;
    if (isObj(i.button_reply)) return str(i.button_reply.title);
    if (isObj(i.list_reply)) return str(i.list_reply.title);
  }
  if (type === "reaction" && isObj(m.reaction)) return `Reagiu com ${str(m.reaction.emoji)}`;
  if (type === "template" && isObj(m.template)) return `[modelo] ${str(m.template.name)}`;
  if (type in MEDIA_LABEL) {
    const o = isObj(m[type]) ? (m[type] as Obj) : {};
    const detail = str(o.caption) || str(o.filename) || (type === "location" ? str(o.name) || str(o.address) : "");
    return `[${MEDIA_LABEL[type]}]${detail ? " " + detail : ""}`;
  }
  return type ? `[${type}]` : "";
}

export function parseWebhook(payload: unknown): WaEnvelope[] {
  if (!isObj(payload) || payload.object !== "whatsapp_business_account") return [];
  const out: WaEnvelope[] = [];
  for (const entry of arr(payload.entry)) {
    if (!isObj(entry)) continue;
    for (const change of arr(entry.changes)) {
      if (!isObj(change) || !isObj(change.value)) continue;
      const field = str(change.field);
      const v = change.value;
      const meta = isObj(v.metadata) ? v.metadata : {};
      const env: WaEnvelope = {
        wabaId: str(entry.id) || null,
        phoneNumberId: str(meta.phone_number_id) || null,
        displayPhone: digits(meta.display_phone_number) || null,
        field,
        events: [],
      };
      const names = new Map<string, string>();
      for (const c of arr(v.contacts)) {
        if (isObj(c) && isObj(c.profile)) names.set(digits(c.wa_id), str(c.profile.name));
      }

      if (field === "messages") {
        for (const m of arr(v.messages)) {
          if (!isObj(m) || !str(m.id)) continue;
          const from = digits(m.from);
          env.events.push({
            kind: "inbound",
            waMessageId: str(m.id),
            from,
            profileName: names.get(from) || null,
            text: messageText(m).slice(0, 4096),
            timestamp: Number(m.timestamp) || 0,
            media: messageMedia(m),
            // Clique em anúncio do Facebook/Instagram que leva ao WhatsApp ("referral" na primeira mensagem).
            ...(isObj(m.referral) ? { fromAd: true } : {}),
          });
        }
        for (const s of arr(v.statuses)) {
          if (!isObj(s) || !str(s.id)) continue;
          const status = str(s.status);
          if (!["sent", "delivered", "read", "failed"].includes(status)) continue;
          const err = arr(s.errors)[0];
          env.events.push({
            kind: "status",
            waMessageId: str(s.id),
            status: status as "sent",
            recipient: digits(s.recipient_id),
            timestamp: Number(s.timestamp) || 0,
            error: isObj(err) ? str(err.title) || str(err.message) || null : null,
          });
        }
      } else if (field === "smb_message_echoes") {
        for (const m of arr(v.message_echoes)) {
          if (!isObj(m) || !str(m.id)) continue;
          env.events.push({
            kind: "echo",
            waMessageId: str(m.id),
            to: digits(m.to),
            text: messageText(m).slice(0, 4096),
            timestamp: Number(m.timestamp) || 0,
            media: messageMedia(m),
          });
        }
      } else if (field === "history") {
        for (const h of arr(v.history)) {
          if (!isObj(h)) continue;
          // Recusa do compartilhamento de histórico no app (erro 2593109) ou progresso da sincronização
          const declined = arr(h.errors).some((e) => isObj(e) && Number(e.code) === 2593109);
          const meta = isObj(h.metadata) ? h.metadata : {};
          env.events.push({
            kind: "history_progress",
            declined,
            progress: meta.progress !== undefined ? Number(meta.progress) : null,
            phase: meta.phase !== undefined ? Number(meta.phase) : null,
          });
          for (const t of arr(h.threads)) {
            if (!isObj(t)) continue;
            const contact = digits(t.id);
            for (const m of arr(t.messages)) {
              if (!isObj(m) || !str(m.id)) continue;
              const from = digits(m.from);
              env.events.push({
                kind: "history",
                waMessageId: str(m.id),
                contact,
                direction: from && from === contact ? "in" : "out",
                text: messageText(m).slice(0, 4096),
                timestamp: Number(m.timestamp) || 0,
                media: messageMedia(m),
              });
            }
          }
        }
      } else if (field === "smb_app_state_sync") {
        for (const s of arr(v.state_sync)) {
          if (!isObj(s) || str(s.type) !== "contact" || !isObj(s.contact)) continue;
          env.events.push({
            kind: "contact_sync",
            phone: digits(s.contact.phone_number),
            name: str(s.contact.full_name) || str(s.contact.first_name) || null,
            action: str(s.action) === "remove" ? "remove" : "add",
          });
        }
      } else if (field === "message_template_status_update") {
        const ev = str(v.event).toUpperCase();
        const status = ev === "APPROVED" ? "APPROVED" : ["REJECTED", "DISABLED", "PAUSED"].includes(ev) ? "REJECTED" : ev === "PENDING" ? "PENDING" : null;
        if (status && str(v.message_template_name)) {
          env.events.push({
            kind: "template_status",
            name: str(v.message_template_name),
            language: str(v.message_template_language),
            status,
            metaTemplateId: str(v.message_template_id),
            reason: str(v.reason),
          });
        }
      }
      out.push(env);
    }
  }
  return out;
}
