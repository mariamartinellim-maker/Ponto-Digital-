/**
 * Normalização dos webhooks da WhatsApp Cloud API (oficial) em eventos internos.
 *
 * Campos (fields) tratados:
 *  - messages            → mensagens recebidas de clientes e atualizações de status
 *  - smb_message_echoes  → coexistência: mensagens enviadas pelo App WhatsApp Business
 *  - history             → coexistência: sincronização do histórico (quando autorizada no onboarding)
 *  - smb_app_state_sync  → coexistência: contatos do App WhatsApp Business
 *
 * Formatos conforme documentação pública da Meta; validar com payloads reais na etapa de integração.
 */

export type WaEvent =
  | { kind: "inbound"; waMessageId: string; from: string; profileName: string | null; text: string; timestamp: number }
  | { kind: "status"; waMessageId: string; status: "sent" | "delivered" | "read" | "failed"; recipient: string; timestamp: number; error: string | null }
  | { kind: "echo"; waMessageId: string; to: string; text: string; timestamp: number }
  | { kind: "history"; waMessageId: string; contact: string; direction: "in" | "out"; text: string; timestamp: number }
  | { kind: "contact_sync"; phone: string; name: string | null; action: "add" | "remove" };

export interface WaEnvelope {
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
  const media = ["image", "video", "audio", "document", "sticker", "location", "contacts"];
  if (media.includes(type)) {
    const caption = isObj(m[type]) ? str((m[type] as Obj).caption) : "";
    return `[${type}]${caption ? " " + caption : ""}`;
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
          });
        }
      } else if (field === "history") {
        for (const h of arr(v.history)) {
          if (!isObj(h)) continue;
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
      }
      out.push(env);
    }
  }
  return out;
}
