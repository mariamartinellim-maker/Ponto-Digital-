import { normalizePhone, phoneDedupKey } from "../phone";
import type { WaEvent, WaMedia } from "../whatsapp/events";

/*
 * Regras puras do módulo EXPERIMENTAL de WhatsApp Web (QR Code, não oficial).
 * Sem dependência da biblioteca de conexão: testáveis isoladamente.
 */

/** Lista de números de uma variável (separados por vírgula, ponto e vírgula ou linha), no formato do WhatsApp. */
export function parseNumbers(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length >= 10)
    .map((n) => normalizePhone(n) ?? n);
}

/** Mesmo número, com ou sem o nono dígito. */
export function sameNumber(a: string, b: string) {
  return phoneDedupKey(a.replace(/\D/g, "")) === phoneDedupKey(b.replace(/\D/g, ""));
}

export const inList = (phone: string | null, list: string[]) => Boolean(phone) && list.some((n) => sameNumber(n, phone!));

/** Telefone de um JID de usuário ("5511999990000:12@s.whatsapp.net" → "5511999990000"). LID e grupos → null. */
export function jidPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const [user, server] = jid.split("@");
  if (server !== "s.whatsapp.net" || !user) return null;
  const digits = user.split(":")[0]!.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

/** Número do aparelho vinculado (sock.user): o JID principal ou o campo phoneNumber (contas com LID). */
export function linkedPhone(user: { id?: string; phoneNumber?: string } | null | undefined): string | null {
  return jidPhone(user?.id) ?? jidPhone(user?.phoneNumber);
}

/** Formato mínimo de uma mensagem recebida pela conexão do WhatsApp Web. */
export interface WebMessage {
  key: { remoteJid?: string | null; remoteJidAlt?: string; fromMe?: boolean | null; id?: string | null };
  message?: Record<string, unknown> | null;
  messageTimestamp?: unknown;
  pushName?: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

const MEDIA: Record<string, { type: WaMedia["type"]; label: string }> = {
  imageMessage: { type: "image", label: "imagem" },
  videoMessage: { type: "video", label: "vídeo" },
  audioMessage: { type: "audio", label: "áudio" },
  documentMessage: { type: "document", label: "documento" },
  stickerMessage: { type: "sticker", label: "figurinha" },
};

/** Remove os invólucros (temporária, visualização única, documento com legenda). */
function unwrap(m: Obj): Obj {
  for (let i = 0; i < 4; i++) {
    const inner = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage"]
      .map((k) => (isObj(m[k]) && isObj((m[k] as Obj).message) ? ((m[k] as Obj).message as Obj) : null))
      .find(Boolean);
    if (!inner) return m;
    m = inner;
  }
  return m;
}

/** Texto e mídia de uma mensagem. A mídia fica no WhatsApp: o CRM guarda só a referência descritiva. */
export function extractContent(raw: Obj | null | undefined): { text: string; media: WaMedia | null } | null {
  if (!raw) return null;
  const m = unwrap(raw);
  if (str(m.conversation)) return { text: str(m.conversation), media: null };
  if (isObj(m.extendedTextMessage) && str(m.extendedTextMessage.text)) return { text: str(m.extendedTextMessage.text), media: null };
  for (const [key, info] of Object.entries(MEDIA)) {
    if (!isObj(m[key])) continue;
    const o = m[key] as Obj;
    const media: WaMedia = { type: info.type };
    if (str(o.mimetype)) media.mime = str(o.mimetype).slice(0, 100);
    if (str(o.fileName)) media.filename = str(o.fileName).slice(0, 200);
    if (str(o.caption)) media.caption = str(o.caption).slice(0, 1024);
    if (o.ptt === true) media.voice = true;
    const detail = media.caption || media.filename || "";
    return { text: `[${info.label}]${detail ? " " + detail : ""}`, media };
  }
  if (isObj(m.locationMessage)) return { text: `[localização] ${str(m.locationMessage.name) || str(m.locationMessage.address)}`.trim(), media: null };
  if (isObj(m.contactMessage)) return { text: `[contato] ${str(m.contactMessage.displayName)}`.trim(), media: null };
  if (isObj(m.reactionMessage)) return str(m.reactionMessage.text) ? { text: `Reagiu com ${str(m.reactionMessage.text)}`, media: null } : null;
  // Protocolo (confirmações, edições, exclusões), chamadas e demais tipos não viram mensagem no CRM.
  return null;
}

/** Tamanho declarado da mídia (bytes), para recusar arquivos grandes antes de baixar. */
export function mediaSize(raw: Obj | null | undefined): number | null {
  if (!raw) return null;
  const m = unwrap(raw);
  for (const key of Object.keys(MEDIA)) {
    if (!isObj(m[key])) continue;
    const n = Number(String((m[key] as Obj).fileLength ?? ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

export type IgnoreReason = "grupo_ou_lista" | "sem_numero" | "sem_conteudo" | "contato_fora_do_teste";

/**
 * Converte uma mensagem do WhatsApp Web em evento interno (o mesmo formato do webhook oficial),
 * para gravar pelo mesmo caminho já testado. Só conversas individuais com contatos de teste.
 */
export function toWaEvent(msg: WebMessage, testContacts: string[]): { event: WaEvent } | { ignored: IgnoreReason } {
  const jid = msg.key.remoteJid ?? "";
  if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return { ignored: "grupo_ou_lista" };
  // Contas novas usam LID (identificador oculto); o telefone vem em remoteJidAlt quando o WhatsApp informa.
  const phone = jidPhone(jid) ?? jidPhone(msg.key.remoteJidAlt);
  if (!phone) return { ignored: "sem_numero" };
  if (!inList(phone, testContacts)) return { ignored: "contato_fora_do_teste" };
  const content = extractContent(msg.message);
  if (!content || !msg.key.id) return { ignored: "sem_conteudo" };
  const ts = Number(String(msg.messageTimestamp ?? "")) || Math.floor(Date.now() / 1000);
  const waMessageId = `waweb.${msg.key.id}`.slice(0, 120);
  const text = content.text.slice(0, 4096);
  if (msg.key.fromMe) return { event: { kind: "echo", waMessageId, to: phone, text, timestamp: ts, media: content.media } };
  return { event: { kind: "inbound", waMessageId, from: phone, profileName: msg.pushName?.slice(0, 120) || null, text, timestamp: ts, media: content.media } };
}

/** Atraso da reconexão automática (2 s, 4 s, 8 s… até 60 s). */
export const reconnectDelay = (attempt: number) => Math.min(60_000, 2000 * 2 ** Math.max(0, attempt - 1));
export const MAX_RECONNECTS = 6;
