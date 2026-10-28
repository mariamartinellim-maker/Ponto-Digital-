import "server-only";
import { randomUUID } from "node:crypto";
import { analyzeReceipt } from "../ai/receipt";
import { getOne, insertOne, listAll, updateOne, type Access } from "../data/collections";
import { audit, findClientByPhone } from "../data/repo";
import { getDb, mutate } from "../data/store";
import type { AutopilotStage, VideoAutopilotSettings, VideoAutopilotState, VideoOrder } from "../data/types";
import { env, testNumbers } from "../env";
import { saveAsset } from "../media/storage";
import { normalizePhone, phoneDedupKey } from "../phone";
import { supabaseAdmin } from "../supabase/admin";
import { isSupabase } from "../supabase/server";
import { waCredentials } from "../whatsapp/client";
import type { WaEnvelope, WaMedia } from "../whatsapp/events";
import { downloadMedia, mediaInfo } from "../whatsapp/graph";
import { classifyReply, detectModality, draftOrder, reviseDraft, type OrderDraft } from "./brain";
import { sendToConversation, type Outgoing } from "./outbox";
import { formatBrPhone, MODALITY_LABEL } from "./rules";
import { confirmPayment, createOrderCore, sendStep, startGeneration, SYSTEM } from "./service";

/*
 * ATENDIMENTO AUTOMÁTICO DOS VÍDEOS (robô), no fluxo combinado com a equipe:
 *  1. contato novo vindo de anúncio → áudio gravado "Seria sobre os vídeos de Uber ou de táxi?"
 *  2. cliente responde a modalidade → áudio "Vamos precisar apenas de uma foto sua e das informações…"
 *  3. foto + informações → a IA escreve a fala, cria o pedido e gera o avatar → avatar enviado para aprovar
 *  4. "pode continuar" → gera o vídeo → prévia com marca d'água + valor e chave Pix
 *     (pedido de ajuste → refaz avatar ou vídeo com o ajuste)
 *  5. comprovante (imagem lida pela IA) → vídeo final sem marca → etiqueta "cliente finalizado"
 * Qualquer coisa fora do roteiro (3 respostas sem entender, falha, limite de gasto) passa para uma pessoa
 * (etapa "humano") e o robô para de responder naquela conversa.
 *
 * Travas: desligado por padrão; "só números de teste" ligado por padrão; os envios passam pelas travas do
 * WhatsApp; as gerações pagas seguem VIDEO_AUTOMACAO e o limite do mês.
 */

const SERVER: Access = { admin: true };
const nowIso = () => new Date().toISOString();
export const TAG_NEW = "novo cliente";
export const TAG_DONE = "cliente finalizado";

export const STAGE_LABEL: Record<AutopilotStage, string> = {
  perguntou_modalidade: "Perguntou Uber ou táxi",
  pediu_foto: "Pediu foto e informações",
  roteiro: "Roteiro (aprovação)",
  avatar: "Avatar (aprovação)",
  video: "Vídeo e pagamento",
  finalizado: "Finalizado",
  humano: "Com a equipe (robô pausado)",
};

/** Saudação conforme a hora em Cuiabá (UTC-4). */
export function greeting(now = new Date()) {
  const h = (now.getUTCHours() + 20) % 24;
  return h >= 5 && h < 12 ? "Oieh, bom diaaa! Tudo bem?" : h >= 12 && h < 18 ? "Oieh, boa tarde! Tudo bem?" : "Oieh, boa noite! Tudo bem?";
}

/** Textos no tom da casa: curtos, calorosos, sem cara de robô (base: padrões reais de atendimento). */
export const TEXTS = {
  ask: "Seu contato seria sobre o vídeo de Uber ou de táxi?",
  askAgain: "Me fala só uma coisa: o vídeo seria pra Uber ou pra táxi?",
  photo: "Perfeito! Pra criar o seu vídeo vou precisar só de uma foto sua (pode ser do rosto) e de umas informações: seu nome, a cidade que você atende e o WhatsApp pros passageiros te chamarem",
  needInfo: "Recebi sua foto! Agora me fala seu nome, a cidade que você atende e o WhatsApp pros passageiros te chamarem",
  needPhoto: "Show! Agora só falta uma foto sua, pode ser do rosto",
  scriptHint: "Se tiver certinho me responde \"pode continuar\" que eu já crio o seu avatar. Se quiser mudar algo é só me falar",
  condensed: "Deixei o texto mais enxuto pra caber certinho no modelo do vídeo curto da oferta, tá?",
  creating: "Show! Já tô criando o seu avatar. Daqui a pouco te mando pra você ver",
  animating: "Fechou! Vou animar o seu vídeo agora",
  adjusting: "Tranquilo, vou ajustar e já te mando de novo",
  approveHint: "Se tiver tudo certo me responde \"pode continuar\". Se quiser mudar alguma coisa é só me falar o quê",
  notReceipt: "Recebi a imagem, mas não consegui ver que é o comprovante. Consegue me mandar o print do comprovante do Pix?",
  handoff: "Só um instante que já te respondo",
  thanks: "Gratidão! Precisando é só chamar",
} as const;

export function scriptText(d: OrderDraft) {
  return [`Olha o roteiro do seu vídeo:`, "", `*Fala:* "${d.speech}"`, `*Nome no final:* ${d.driverName}`, ...(d.contactPhone ? [`*WhatsApp:* ${formatBrPhone(d.contactPhone)}`] : [])].join("\n");
}

/** Pagamento em 3 mensagens: a chave Pix vai sozinha, para o cliente copiar com um toque (como a equipe faz). */
export function paymentMessages(s: Pick<VideoAutopilotSettings, "priceText" | "pixKey">) {
  return [`Pra liberar o vídeo sem a marca d'água fica ${s.priceText.trim()}. Segue a chave Pix:`, s.pixKey.trim(), "Me manda o comprovante aqui que já te envio"];
}

async function sayAll(t: Target, orgId: string, bodies: string[]) {
  for (const body of bodies) await say(t, orgId, { kind: "text", body });
}

// ---------------------------------------------------------------------------
// Configuração e andamento
// ---------------------------------------------------------------------------
export async function getSettings(orgId: string): Promise<VideoAutopilotSettings | null> {
  return (await listAll(orgId, "videoAutopilotSettings", { limit: 1, ...SERVER }))[0] ?? null;
}

export async function saveSettings(orgId: string, userId: string, patch: Omit<VideoAutopilotSettings, "id" | "orgId" | "updatedBy" | "updatedAt">) {
  const current = await getSettings(orgId);
  const row = { ...patch, updatedBy: userId, updatedAt: nowIso() };
  if (current) return updateOne(orgId, "videoAutopilotSettings", current.id, row, SERVER);
  return insertOne("videoAutopilotSettings", { id: randomUUID(), orgId, ...row }, SERVER);
}

export async function listStates(orgId: string) {
  return listAll(orgId, "videoAutopilotStates", { order: "updatedAt", desc: true, limit: 50, ...SERVER });
}

async function stateFor(orgId: string, conversationId: string) {
  return (await listAll(orgId, "videoAutopilotStates", { where: { conversationId }, limit: 1, ...SERVER }))[0] ?? null;
}

async function patchState(st: VideoAutopilotState, patch: Partial<VideoAutopilotState>) {
  Object.assign(st, patch, { updatedAt: nowIso() });
  await updateOne(st.orgId, "videoAutopilotStates", st.id, { ...patch, updatedAt: st.updatedAt }, SERVER);
}

/** Pausa (passa para a equipe) ou reinicia o robô numa conversa. Chamado pela tela, depois da checagem de permissão. */
export async function setConversationStage(orgId: string, stateId: string, action: "pausar" | "reiniciar") {
  const st = await getOne(orgId, "videoAutopilotStates", stateId, SERVER);
  if (!st) return false;
  if (action === "pausar") await patchState(st, { stage: "humano", note: "Pausado pela equipe." });
  else await patchState(st, { stage: "perguntou_modalidade", modality: null, info: "", photoAssetId: null, draft: null, orderId: null, retries: 0, note: "Reiniciado pela equipe." });
  return true;
}

// ---------------------------------------------------------------------------
// Cliente e conversa (sem usuário logado)
// ---------------------------------------------------------------------------
interface Target {
  client: { id: string; name: string; phone: string; city: string; tags: string[] };
  conversationId: string;
  inboundCount: number;
}

async function findTarget(orgId: string, rawPhone: string): Promise<Target | null> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  if (isSupabase()) {
    const db = supabaseAdmin();
    const key = phoneDedupKey(phone);
    const variants = [...new Set([phone, key, key.length === 12 && key.startsWith("55") ? key.slice(0, 4) + "9" + key.slice(4) : key])];
    const { data: clients } = await db.from("clients").select("id,name,phone,city,tags").eq("org_id", orgId).in("phone", variants).limit(1);
    const c = clients?.[0];
    if (!c) return null;
    const { data: conv } = await db.from("conversations").select("id").eq("org_id", orgId).eq("client_id", c.id).maybeSingle();
    if (!conv) return null;
    const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("direction", "in");
    return { client: { id: String(c.id), name: String(c.name), phone: String(c.phone), city: String(c.city ?? ""), tags: (c.tags as string[]) ?? [] }, conversationId: String(conv.id), inboundCount: count ?? 0 };
  }
  const d = await getDb();
  const c = findClientByPhone(d, orgId, phone);
  const conv = c && d.conversations.find((x) => x.orgId === orgId && x.clientId === c.id);
  if (!c || !conv) return null;
  return { client: { id: c.id, name: c.name, phone: c.phone, city: c.city, tags: c.tags }, conversationId: conv.id, inboundCount: d.messages.filter((m) => m.conversationId === conv.id && m.direction === "in").length };
}

async function setTags(orgId: string, client: Target["client"], add: string[], remove: string[] = []) {
  const tags = [...new Set([...client.tags.filter((t) => !remove.includes(t)), ...add])].slice(0, 20);
  client.tags = tags;
  if (isSupabase()) {
    const { error } = await supabaseAdmin().from("clients").update({ tags }).eq("org_id", orgId).eq("id", client.id);
    if (error) console.warn("[robô] etiquetas não salvas:", error.message);
    return;
  }
  await mutate((d) => {
    const c = d.clients.find((x) => x.id === client.id);
    if (c) c.tags = tags;
  });
}

// ---------------------------------------------------------------------------
// Mensagens recebidas
// ---------------------------------------------------------------------------
export interface InboundMessage {
  orgId: string;
  phone: string;
  waMessageId: string;
  text: string;
  media: WaMedia | null;
  fromAd: boolean;
  timestamp: number;
}
export type MediaFetcher = (media: WaMedia) => Promise<{ bytes: Uint8Array; mime: string } | null>;

/** Baixa a mídia recebida da Meta (Cloud API) com o token do servidor. */
export function metaMediaFetcher(orgId: string): MediaFetcher {
  return async (media) => {
    if (!media.id) return null;
    const creds = await waCredentials(orgId);
    if (!creds) return null;
    const info = await mediaInfo(media.id, creds.token);
    if ((info.file_size ?? 0) > 10 * 1024 * 1024) return null;
    const res = await downloadMedia(info.url, creds.token);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: (info.mime_type || media.mime || "").split(";")[0]!.trim().toLowerCase() };
  };
}

/** Chamado pelo webhook depois de gravar os eventos: passa cada mensagem recebida ao robô. */
export async function runAutopilot(envelopes: WaEnvelope[], orgFor: (e: WaEnvelope) => string | null, fetcher: (orgId: string) => MediaFetcher = metaMediaFetcher) {
  for (const envl of envelopes) {
    const orgId = orgFor(envl);
    if (!orgId) continue;
    for (const ev of envl.events) {
      if (ev.kind !== "inbound") continue;
      await handleInbound({ orgId, phone: ev.from, waMessageId: ev.waMessageId, text: ev.text, media: ev.media, fromAd: Boolean(ev.fromAd), timestamp: ev.timestamp }, fetcher(orgId)).catch((e: unknown) =>
        console.error("[robô] mensagem não processada:", (e as Error).message),
      );
    }
  }
}

// Idempotência (a Meta reenvia eventos) e uma mensagem por vez em cada conversa.
const g = globalThis as unknown as { __pdAutopilotSeen?: Set<string>; __pdAutopilotQueue?: Map<string, Promise<void>> };
const seen = (g.__pdAutopilotSeen ??= new Set());
const queue: Map<string, Promise<void>> = (g.__pdAutopilotQueue ??= new Map());

export async function handleInbound(msg: InboundMessage, fetchMedia: MediaFetcher): Promise<void> {
  if (seen.has(msg.waMessageId)) return;
  seen.add(msg.waMessageId);
  if (seen.size > 5000) seen.delete(seen.values().next().value!);
  // Reenvios antigos e histórico sincronizado não disparam o robô.
  if (msg.timestamp && Date.now() / 1000 - msg.timestamp > 15 * 60) return;

  const settings = await getSettings(msg.orgId);
  if (!settings?.enabled) return;
  const phoneKey = phoneDedupKey(normalizePhone(msg.phone) ?? msg.phone);
  const isTest = testNumbers().some((n) => phoneDedupKey(n) === phoneKey);
  if (settings.testOnly && !isTest) return;
  const target = await findTarget(msg.orgId, msg.phone);
  if (!target) return;

  const key = target.conversationId;
  const prev = queue.get(key) ?? Promise.resolve();
  const run = prev.then(() => step(msg, settings, target, fetchMedia)).catch((e: unknown) => console.error("[robô]", (e as Error).message));
  queue.set(key, run);
  await run;
  if (queue.get(key) === run) queue.delete(key);
}

async function say(t: Target, orgId: string, out: Outgoing) {
  const r = await sendToConversation(orgId, t.conversationId, out, null);
  if (!r.ok) console.warn("[robô] envio não realizado:", r.error);
  return r.ok;
}

const voiceOr = (assetId: string | null, text: string): Outgoing => (assetId ? { kind: "asset", assetId } : { kind: "text", body: text });

async function handoff(st: VideoAutopilotState, t: Target, note: string) {
  await patchState(st, { stage: "humano", note: note.slice(0, 300) });
  await say(t, st.orgId, { kind: "text", body: TEXTS.handoff });
  await audit({ orgId: st.orgId, userId: null, action: "video.robo_passou_para_equipe", entity: "conversa", entityId: st.conversationId, details: note.slice(0, 300) });
}

async function savePhoto(orgId: string, t: Target, media: WaMedia, fetchMedia: MediaFetcher, tag = "foto") {
  const file = await fetchMedia(media).catch(() => null);
  if (!file) return null;
  const a = await saveAsset({ orgId, bytes: file.bytes, mime: file.mime, filename: `${tag}-whatsapp.jpg`, title: `${tag === "foto" ? "Foto" : "Comprovante"} · ${t.client.name}`, tags: tag === "foto" ? ["video-avatar", "foto"] : ["comprovante", "video-avatar"], source: "whatsapp", clientId: t.client.id, createdBy: null }, SERVER);
  if ("error" in a) {
    console.warn("[robô] arquivo recebido não salvo:", a.error);
    return null;
  }
  return { asset: a, bytes: file.bytes, mime: file.mime };
}

async function step(msg: InboundMessage, s: VideoAutopilotSettings, t: Target, fetchMedia: MediaFetcher) {
  const orgId = msg.orgId;
  const isImage = msg.media?.type === "image";
  const isDoc = msg.media?.type === "document";
  const text = msg.media ? (msg.media.caption ?? "") : msg.text;
  let st = await stateFor(orgId, t.conversationId);

  // Início: contato novo (vindo de anúncio, se assim configurado). Com "só números de teste", qualquer
  // mensagem do número de teste começa o fluxo, para a equipe conseguir testar.
  if (!st) {
    const fresh = t.inboundCount <= 1 && (s.trigger === "contato_novo" || msg.fromAd);
    if (!fresh && !s.testOnly) return;
    st = await insertOne(
      "videoAutopilotStates",
      { id: randomUUID(), orgId, conversationId: t.conversationId, clientId: t.client.id, stage: "perguntou_modalidade", modality: null, info: "", photoAssetId: null, draft: null, orderId: null, retries: 0, note: msg.fromAd ? "Veio de anúncio." : "", createdAt: nowIso(), updatedAt: nowIso() },
      SERVER,
    );
    await setTags(orgId, t.client, [TAG_NEW]);
    await audit({ orgId, userId: null, action: "video.robo_iniciou", entity: "conversa", entityId: t.conversationId, details: t.client.name });
    const modality = detectModality(text);
    if (modality) return askPhoto(st, s, t, modality);
    if (s.audioAskAssetId) await say(t, orgId, { kind: "asset", assetId: s.audioAskAssetId });
    else {
      await say(t, orgId, { kind: "text", body: greeting() });
      await say(t, orgId, { kind: "text", body: TEXTS.ask });
    }
    return;
  }

  switch (st.stage) {
    case "perguntou_modalidade": {
      if (isImage) {
        const p = await savePhoto(orgId, t, msg.media!, fetchMedia);
        if (p) await patchState(st, { photoAssetId: p.asset.id });
      }
      const modality = detectModality(text);
      if (modality) return askPhoto(st, s, t, modality);
      if (st.retries >= 2) return handoff(st, t, "Não entendeu se o vídeo é de Uber ou táxi.");
      await patchState(st, { retries: st.retries + 1 });
      await say(t, orgId, { kind: "text", body: TEXTS.askAgain });
      return;
    }
    case "pediu_foto": {
      let justGotPhoto = false;
      if (isImage) {
        const p = await savePhoto(orgId, t, msg.media!, fetchMedia);
        if (!p) return handoff(st, t, "Não foi possível baixar a foto enviada.");
        await patchState(st, { photoAssetId: p.asset.id });
        justGotPhoto = true;
      }
      const wroteInfo = text.trim().length > 0;
      if (wroteInfo) await patchState(st, { info: `${st.info}\n${text.trim()}`.trim().slice(-3000) });
      if (st.photoAssetId && st.info) return proposeScript(st, t);
      if (justGotPhoto) await say(t, orgId, { kind: "text", body: TEXTS.needInfo });
      else if (wroteInfo && !st.note.includes("pediu-foto")) {
        await patchState(st, { note: `${st.note} pediu-foto`.trim() });
        await say(t, orgId, { kind: "text", body: TEXTS.needPhoto });
      }
      return;
    }
    case "roteiro":
      return scriptStep(st, t, msg, text, isImage, fetchMedia);
    case "avatar":
    case "video":
      return orderStep(st, s, t, msg, text, isImage || isDoc, fetchMedia);
    default:
      return; // finalizado ou com a equipe: o robô não responde
  }
}

async function askPhoto(st: VideoAutopilotState, s: VideoAutopilotSettings, t: Target, modality: "uber" | "taxi") {
  await patchState(st, { stage: "pediu_foto", modality, retries: 0 });
  await say(t, st.orgId, voiceOr(s.audioPhotoAssetId, TEXTS.photo));
}

/** Roteiro curto (cabe nos 10 s) para o cliente aprovar antes do avatar. Se resumiu, explica o porquê. */
async function proposeScript(st: VideoAutopilotState, t: Target) {
  const draft = await draftOrder({ modality: st.modality ?? "uber", clientName: t.client.name, text: st.info });
  if (!draft.contactPhone) draft.contactPhone = t.client.phone;
  await sendScript(st, t, draft);
}

async function sendScript(st: VideoAutopilotState, t: Target, draft: OrderDraft) {
  const { condensed, ...rest } = draft;
  await patchState(st, { stage: "roteiro", draft: rest, retries: 0 });
  if (condensed) await say(t, st.orgId, { kind: "text", body: TEXTS.condensed });
  await say(t, st.orgId, { kind: "text", body: scriptText(rest) });
  await say(t, st.orgId, { kind: "text", body: TEXTS.scriptHint });
}

async function scriptStep(st: VideoAutopilotState, t: Target, msg: InboundMessage, text: string, isImage: boolean, fetchMedia: MediaFetcher) {
  if (isImage) {
    const p = await savePhoto(st.orgId, t, msg.media!, fetchMedia);
    if (p) await patchState(st, { photoAssetId: p.asset.id }); // foto nova substitui a anterior
  }
  if (!text.trim() || !st.draft) return;
  const r = await classifyReply(text, "roteiro");
  if (r.intent === "aprovado") return createFromConversation(st, t);
  if (r.intent === "ajuste") {
    const revised = await reviseDraft(st.draft, r.ajuste, st.modality ?? "uber");
    if (!revised) return handoff(st, t, `Cliente pediu ajuste no roteiro: "${r.ajuste}"`);
    return sendScript(st, t, revised);
  }
  if (st.retries >= 2) return handoff(st, t, "Resposta não entendida na aprovação do roteiro.");
  await patchState(st, { retries: st.retries + 1 });
  await say(t, st.orgId, { kind: "text", body: TEXTS.scriptHint });
}

async function createFromConversation(st: VideoAutopilotState, t: Target) {
  const modality = st.modality ?? "uber";
  const draft = st.draft ?? (await draftOrder({ modality, clientName: t.client.name, text: st.info }));
  const created = await createOrderCore(SYSTEM(st.orgId), t.client, t.conversationId, { modality, ...draft }, st.photoAssetId!, true);
  if (!created.ok) return handoff(st, t, `Pedido não criado: ${created.error}`);
  await patchState(st, { stage: "avatar", orderId: created.value.id, retries: 0 });
  const gen = await startGeneration(SYSTEM(st.orgId), created.value.id, "gerar_avatar", "");
  if (!gen.ok) return handoff(st, t, `Avatar não iniciado: ${gen.error}`);
  await say(t, st.orgId, { kind: "text", body: TEXTS.creating });
}

async function orderStep(st: VideoAutopilotState, s: VideoAutopilotSettings, t: Target, msg: InboundMessage, text: string, isFile: boolean, fetchMedia: MediaFetcher) {
  const order = st.orderId ? await getOne(st.orgId, "videoOrders", st.orderId, SERVER) : null;
  if (!order || order.status === "cancelado") return handoff(st, t, "Pedido de vídeo não encontrado ou cancelado.");
  if (order.status === "falhou") return handoff(st, t, `Falha na geração: ${order.error ?? ""}`);
  // Gerando: aguarda (as mensagens ficam na conversa para a equipe ver).
  if (order.status === "gerando_avatar" || order.status === "gerando_video" || order.status === "avatar_pronto" || order.status === "video_pronto") return;

  if (order.status === "aguardando_pagamento" && isFile) return checkReceipt(st, t, order, msg, fetchMedia);
  if (order.status === "pago") return;
  if (!text.trim()) return;

  const about = order.status === "avatar_enviado" ? "avatar" : "vídeo";
  const r = await classifyReply(text, about);
  if (r.intent === "ajuste") {
    const gen = await startGeneration(SYSTEM(st.orgId), order.id, about === "avatar" ? "gerar_avatar" : "gerar_video", r.ajuste);
    if (!gen.ok) return handoff(st, t, `Ajuste não iniciado: ${gen.error}`);
    await patchState(st, { retries: 0 });
    await say(t, st.orgId, { kind: "text", body: TEXTS.adjusting });
    return;
  }
  if (r.intent === "aprovado" && about === "avatar") {
    const gen = await startGeneration(SYSTEM(st.orgId), order.id, "gerar_video", "");
    if (!gen.ok) return handoff(st, t, `Vídeo não iniciado: ${gen.error}`);
    await patchState(st, { stage: "video", retries: 0 });
    await say(t, st.orgId, { kind: "text", body: TEXTS.animating });
    return;
  }
  if (r.intent === "aprovado" && s.priceText && s.pixKey) {
    await sayAll(t, st.orgId, paymentMessages(s));
    return;
  }
  if (st.retries >= 2) return handoff(st, t, `Resposta não entendida na etapa ${about}.`);
  await patchState(st, { retries: st.retries + 1 });
  if (about === "avatar") await say(t, st.orgId, { kind: "text", body: TEXTS.approveHint });
  else if (s.priceText && s.pixKey) await sayAll(t, st.orgId, paymentMessages(s));
  else await say(t, st.orgId, { kind: "text", body: TEXTS.handoff });
}

/** Comprovante: basta a IA reconhecer que a imagem é um comprovante de pagamento (risco aceito pelo dono). */
async function checkReceipt(st: VideoAutopilotState, t: Target, order: VideoOrder, msg: InboundMessage, fetchMedia: MediaFetcher) {
  const p = await savePhoto(st.orgId, t, msg.media!, fetchMedia, "comprovante");
  if (!p) return handoff(st, t, "Não foi possível baixar o comprovante.");
  if (!env().ANTHROPIC_API_KEY) return handoff(st, t, "Comprovante recebido, mas a leitura automática está desligada (ANTHROPIC_API_KEY). Confira e envie o vídeo final pela tela Vídeos.");
  const r = await analyzeReceipt(p.bytes, p.mime);
  if (!r.ok) return handoff(st, t, `Comprovante não lido: ${r.error}`);
  if (!r.isReceipt) {
    if (st.retries >= 2) return handoff(st, t, "Cliente mandou imagens que não parecem comprovante.");
    await patchState(st, { retries: st.retries + 1 });
    await say(t, st.orgId, { kind: "text", body: TEXTS.notReceipt });
    return;
  }
  const paid = await confirmPayment(SYSTEM(st.orgId), order.id, p.asset.id);
  if (!paid.ok) return handoff(st, t, `Pagamento não registrado: ${paid.error}`);
  const sent = await sendStep(SYSTEM(st.orgId), order.id, "enviar_final");
  if (!sent.ok) return handoff(st, t, `Vídeo final não enviado: ${sent.error}`);
  await patchState(st, { stage: "finalizado", retries: 0, note: `Pago (comprovante lido pela IA${r.data.valorCentavos ? `, R$ ${(r.data.valorCentavos / 100).toFixed(2).replace(".", ",")}` : ""}).` });
  await setTags(st.orgId, t.client, [TAG_DONE], [TAG_NEW]);
  await say(t, st.orgId, { kind: "text", body: TEXTS.thanks });
}

// ---------------------------------------------------------------------------
// Avisos da geração (chamados pelo serviço quando avatar ou vídeo ficam prontos)
// ---------------------------------------------------------------------------
async function stateOfOrder(o: VideoOrder) {
  return o.conversationId ? stateFor(o.orgId, o.conversationId) : null;
}

export async function onAvatarReady(o: VideoOrder) {
  const st = await stateOfOrder(o);
  if (!st || st.stage !== "avatar") return;
  const r = await sendStep(SYSTEM(o.orgId), o.id, "enviar_avatar");
  if (!r.ok) await patchState(st, { stage: "humano", note: `Avatar pronto, mas não enviado: ${r.error}`.slice(0, 300) });
}

export async function onVideoReady(o: VideoOrder) {
  const st = await stateOfOrder(o);
  if (!st || st.stage !== "video") return;
  const r = await sendStep(SYSTEM(o.orgId), o.id, "enviar_previa");
  if (!r.ok) return patchState(st, { stage: "humano", note: `Vídeo pronto, mas não enviado: ${r.error}`.slice(0, 300) });
  const s = await getSettings(o.orgId);
  if (s?.priceText && s.pixKey) {
    for (const body of paymentMessages(s)) await sendToConversation(o.orgId, st.conversationId, { kind: "text", body }, null);
  } else {
    await patchState(st, { stage: "humano", note: "Prévia enviada. Falta configurar valor e chave Pix no robô: a equipe precisa passar o pagamento." });
  }
}

export const modalityLabel = (m: VideoAutopilotState["modality"]) => (m ? MODALITY_LABEL[m] : "—");
