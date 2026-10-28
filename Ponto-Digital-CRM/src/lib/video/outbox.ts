import "server-only";
import { randomUUID } from "node:crypto";
import type { SessionUser } from "../auth/session";
import { getOne } from "../data/collections";
import { appendMessage } from "../data/repo";
import { getDb, mutate } from "../data/store";
import type { Conversation, MessageMedia } from "../data/types";
import { windowOpen } from "../inbox";
import { loadTarget, recordOutgoing } from "../inbox-send";
import { getFile } from "../media/storage";
import { supabaseAdmin } from "../supabase/admin";
import { toConversation } from "../supabase/data";
import { isSupabase } from "../supabase/server";
import { sendDecision, sendWhatsApp, waCredentials } from "../whatsapp/client";
import { GraphError, uploadMedia } from "../whatsapp/graph";
import { toVoiceNote } from "./ffmpeg";

/**
 * Envio dos vídeos e do atendimento automático pelo WhatsApp oficial, por uma pessoa (botões da tela)
 * ou pelo próprio sistema (robô, sem usuário logado; a mensagem fica com origem "sistema").
 * Sempre passa pelas travas do WhatsApp: simulação, ambiente de teste e números de teste.
 */
export type Outgoing =
  | { kind: "text"; body: string }
  | { kind: "asset"; assetId: string; caption?: string }
  | { kind: "pix"; summary: string; referenceId: string; itemName: string; amountCents: number; code: string; merchantName: string; key: string; keyType: string };
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const LABEL = { image: "imagem", audio: "áudio", video: "vídeo", document: "documento" } as const;

async function systemTarget(orgId: string, convId: string): Promise<{ conv: Conversation; phone: string } | null> {
  if (isSupabase()) {
    const db = supabaseAdmin();
    const { data: c } = await db.from("conversations").select("*").eq("org_id", orgId).eq("id", convId).maybeSingle();
    if (!c) return null;
    const { data: client } = await db.from("clients").select("phone").eq("org_id", orgId).eq("id", c.client_id).maybeSingle();
    if (!client) return null;
    return { conv: toConversation(c), phone: String(client.phone) };
  }
  const db = await getDb();
  const conv = db.conversations.find((c) => c.orgId === orgId && c.id === convId);
  const client = conv && db.clients.find((c) => c.id === conv.clientId);
  return conv && client ? { conv, phone: client.phone } : null;
}

async function recordSystem(conv: Conversation, body: string, simulated: boolean, waMessageId: string, media: MessageMedia | null) {
  const status = simulated ? "simulada" : "enviada";
  if (isSupabase()) {
    const { error } = await supabaseAdmin()
      .from("messages")
      .insert({ org_id: conv.orgId, conversation_id: conv.id, direction: "out", origin: "sistema", body, status, wa_message_id: waMessageId, ...(media ? { media } : {}) });
    return error ? error.message : null;
  }
  await mutate((d) => {
    const live = d.conversations.find((c) => c.id === conv.id)!;
    appendMessage(d, live, { direction: "out", origin: "sistema", body, status, waMessageId, authorId: null, media });
  });
  return null;
}

export async function sendToConversation(orgId: string, convId: string, out: Outgoing, actor: SessionUser | null): Promise<Result<{ simulated: boolean }>> {
  let target: { conv: Conversation; phone: string } | null = null;
  try {
    target = actor ? await loadTarget(actor, convId) : await systemTarget(orgId, convId);
  } catch {
    target = null;
  }
  if (!target) return fail("Conversa não encontrada.");
  if (!windowOpen(target.conv)) return fail("Fora da janela de 24h do WhatsApp: o cliente precisa mandar uma mensagem antes.");
  const decision = sendDecision(target.phone);
  if (decision.mode === "blocked") return fail(decision.reason);

  let media: MessageMedia | null = null;
  let file: { bytes: Buffer; mime: string; filename: string } | null = null;
  let body: string;
  if (out.kind === "asset") {
    const asset = await getOne(orgId, "mediaAssets", out.assetId, { admin: !actor });
    const bytes = asset ? await getFile(asset.storageKey) : null;
    if (!asset || !bytes || asset.type === "document") return fail("Arquivo do envio não encontrado.");
    const voice = asset.type === "audio";
    media = { type: asset.type, mime: voice ? "audio/ogg" : asset.mime, filename: asset.filename, assetId: asset.id, ...(voice ? { voice: true } : {}), ...(out.caption ? { caption: out.caption } : {}) };
    if (decision.mode === "live") file = voice ? { bytes: await toVoiceNote(bytes), mime: "audio/ogg", filename: "audio.ogg" } : { bytes, mime: asset.mime, filename: asset.filename };
    body = `[${LABEL[asset.type]}]${out.caption ? " " + out.caption : voice ? " Mensagem de voz" : ""}`.slice(0, 4096);
  } else if (out.kind === "pix") {
    body = out.summary.slice(0, 4096);
  } else {
    body = out.body.slice(0, 4096);
  }

  let simulated = true;
  let waMessageId = `wamid.SIMULADO.${randomUUID()}`;
  if (decision.mode === "live") {
    let r;
    if (file && media) {
      const creds = await waCredentials(orgId);
      if (!creds) return fail("Credenciais da Cloud API não configuradas.");
      try {
        media.id = await uploadMedia(creds.phoneNumberId, creds.token, new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.filename);
      } catch (err) {
        return fail(`Falha ao enviar o arquivo à Meta: ${err instanceof GraphError ? err.message : "erro de conexão"}`);
      }
      const type = media.type === "image" ? "image" : media.type === "audio" ? "audio" : "video";
      r = await sendWhatsApp({ type: "media", to: target.phone, media: type, mediaId: media.id, caption: out.kind === "asset" ? out.caption : undefined }, { orgId });
    } else if (out.kind === "pix") {
      const { summary, ...pix } = out;
      r = await sendWhatsApp({ type: "pix", to: target.phone, body: summary, ...pix }, { orgId });
    } else {
      r = await sendWhatsApp({ type: "text", to: target.phone, body }, { orgId });
    }
    if (!r.ok) return fail(`Falha no envio: ${r.error}`);
    simulated = r.simulated;
    waMessageId = r.waMessageId;
  } else if (media) {
    media.simulated = true;
  }

  const err = actor ? await recordOutgoing(actor, target.conv, body, simulated, waMessageId, { media }) : await recordSystem(target.conv, body, simulated, waMessageId, media);
  if (err) return fail(err);
  return { ok: true, value: { simulated } };
}
