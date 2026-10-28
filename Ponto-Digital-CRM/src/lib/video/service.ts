import "server-only";
import { randomUUID } from "node:crypto";
import type { SessionUser } from "../auth/session";
import { getOne, insertOne, listAll, nextNumber, updateOne, type Access } from "../data/collections";
import { audit, scoped } from "../data/repo";
import type { MediaAsset, MessageMedia, VideoModality, VideoOrder, VideoOrderStatus } from "../data/types";
import { env } from "../env";
import { windowOpen } from "../inbox";
import { loadTarget, recordOutgoing } from "../inbox-send";
import { getFile, saveAsset } from "../media/storage";
import { sendDecision, sendWhatsApp, waCredentials } from "../whatsapp/client";
import { GraphError, uploadMedia } from "../whatsapp/graph";
import { applyWatermark, finishVideo, photoToVideo, toJpeg } from "./ffmpeg";
import { generateAvatar, generateVideo, ProviderError, providersConfigured } from "./providers";
import { avatarPrompt, animationPrompt, canDo, endCardLines, isStuck, monthStartCuiaba, paidRunsLeft, validateOrderInput, type VideoAction } from "./rules";

/*
 * Pedidos de vídeo com avatar: foto → avatar → aprovação do cliente → vídeo → prévia com marca d'água →
 * pagamento → vídeo limpo. As etapas demoradas (avatar e vídeo) rodam em segundo plano no servidor;
 * a tela acompanha pelo status do pedido.
 *
 * Gasto: as APIs pagas só são chamadas com VIDEO_AUTOMACAO=true, as duas chaves configuradas e dentro do
 * limite mensal (VIDEO_LIMITE_MES). Fora disso, o pedido roda no simulador gratuito (sem IA).
 * Envio: sempre pelas travas do WhatsApp (simulação, ambiente de teste e números de teste).
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const nowIso = () => new Date().toISOString();
// Arquivos e etapas pagas são gravados pela chave do servidor, depois da checagem de permissão feita aqui.
const SERVER: Access = { admin: true };

export function videoEngine(): VideoOrder["engine"] {
  const p = providersConfigured();
  return env().VIDEO_AUTOMACAO && p.avatar && p.video ? "ia" : "simulador";
}

/** Gerações pagas (avatar + vídeo pela IA) usadas no mês, para o teto de gasto. */
export async function paidRunsThisMonth(orgId: string): Promise<number> {
  const since = monthStartCuiaba();
  const orders = await listAll(orgId, "videoOrders", { order: "createdAt", desc: true, limit: 1000, ...SERVER });
  return orders.filter((o) => o.engine === "ia" && o.updatedAt >= since).reduce((n, o) => n + o.avatarRuns + o.videoRuns, 0);
}

export async function videoUsage(orgId: string) {
  const e = env();
  const used = await paidRunsThisMonth(orgId);
  return { engine: videoEngine(), used, limit: e.VIDEO_LIMITE_MES, left: paidRunsLeft(used, e.VIDEO_LIMITE_MES), enabled: e.VIDEO_AUTOMACAO, ...providersConfigured() };
}

/** Pedido com a etapa "gerando" travada há mais de 15 min tratado como falha (pode refazer). */
export function withStuck(o: VideoOrder): VideoOrder {
  return isStuck(o) ? { ...o, status: "falhou", error: o.error ?? "A geração foi interrompida (o servidor reiniciou). Tente de novo." } : o;
}

async function loadOrder(user: SessionUser, id: string) {
  const o = await getOne(user.orgId, "videoOrders", id);
  return o ? withStuck(o) : null;
}

async function setStatus(orgId: string, id: string, status: VideoOrderStatus, patch: Partial<VideoOrder> = {}) {
  return updateOne(orgId, "videoOrders", id, { status, updatedAt: nowIso(), ...patch }, SERVER);
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------
export async function createVideoOrder(
  user: SessionUser,
  input: { clientId: string; conversationId?: string | null; modality: string; driverGender: string; driverName: string; city: string; speech: string; contactPhone: string; photo: { bytes: Uint8Array; mime: string; filename: string } },
): Promise<Result<VideoOrder>> {
  const err = validateOrderInput(input);
  if (err) return fail(err);
  const d = await scoped(user.orgId);
  const client = d.clients.find((c) => c.id === input.clientId);
  if (!client) return fail("Cliente não encontrado.");
  if (!input.photo.mime.startsWith("image/")) return fail("A foto precisa ser uma imagem (JPG, PNG ou WEBP).");
  const conv = input.conversationId ? d.conversations.find((c) => c.id === input.conversationId) : d.conversations.find((c) => c.clientId === client.id);
  const photo = await saveAsset(
    { orgId: user.orgId, ...input.photo, title: `Foto · ${client.name}`, tags: ["video-avatar", "foto"], source: "upload", clientId: client.id, createdBy: user.id },
    SERVER,
  );
  if ("error" in photo) return fail(photo.error);
  const order: VideoOrder = {
    id: randomUUID(),
    orgId: user.orgId,
    number: await nextNumber(user.orgId, "videoOrders"),
    clientId: client.id,
    conversationId: conv?.id ?? null,
    modality: input.modality as VideoModality,
    driverName: input.driverName.trim().slice(0, 80),
    driverGender: input.driverGender === "feminino" ? "feminino" : "masculino",
    city: (input.city.trim() || client.city).slice(0, 80),
    speech: input.speech.trim().slice(0, 400),
    // O cliente é o próprio motorista: sem número informado, o vídeo mostra o WhatsApp dele.
    contactPhone: (input.contactPhone.trim() || client.phone).slice(0, 30),
    adjustments: "",
    status: "foto_recebida",
    photoAssetId: photo.id,
    avatarAssetId: null,
    videoAssetId: null,
    previewAssetId: null,
    receiptAssetId: null,
    avatarRuns: 0,
    videoRuns: 0,
    engine: videoEngine(),
    error: null,
    createdBy: user.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    avatarSentAt: null,
    previewSentAt: null,
    paidAt: null,
    deliveredAt: null,
  };
  try {
    const saved = await insertOne("videoOrders", order, SERVER);
    await audit({ orgId: user.orgId, userId: user.id, action: "video.pedido_criado", entity: "video", entityId: saved.id, details: `nº ${saved.number} · ${client.name}` });
    return { ok: true, value: saved };
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Etapas em segundo plano
// ---------------------------------------------------------------------------
async function assetBytes(orgId: string, assetId: string | null): Promise<{ asset: MediaAsset; bytes: Buffer }> {
  const asset = assetId ? await getOne(orgId, "mediaAssets", assetId, SERVER) : null;
  const bytes = asset ? await getFile(asset.storageKey) : null;
  if (!asset || !bytes) throw new Error("Arquivo do pedido não encontrado no armazenamento.");
  return { asset, bytes };
}

async function store(o: VideoOrder, bytes: Buffer, mime: string, filename: string, title: string, tag: string) {
  const a = await saveAsset({ orgId: o.orgId, bytes, mime, filename, title, tags: ["video-avatar", tag], source: "upload", clientId: o.clientId, createdBy: o.createdBy }, SERVER);
  if ("error" in a) throw new Error(a.error);
  return a;
}

const friendly = (e: unknown) => (e instanceof ProviderError ? e.message : `Falha inesperada: ${(e as Error).message}`).slice(0, 500);

async function avatarJob(o: VideoOrder) {
  try {
    const { asset, bytes } = await assetBytes(o.orgId, o.photoAssetId);
    const raw = o.engine === "ia" ? await generateAvatar(bytes, asset.mime, avatarPrompt(o)) : { bytes, mime: asset.mime };
    const jpg = await toJpeg(raw.bytes, raw.mime);
    const saved = await store(o, jpg, "image/jpeg", `avatar-${o.number}-${o.avatarRuns}.jpg`, `Avatar nº ${o.number}`, "avatar");
    await setStatus(o.orgId, o.id, "avatar_pronto", { avatarAssetId: saved.id, error: null });
  } catch (e) {
    console.error("[video] avatar", o.id, (e as Error).message);
    await setStatus(o.orgId, o.id, "falhou", { error: friendly(e) }).catch(() => {});
  }
}

async function videoJob(o: VideoOrder) {
  try {
    const { asset, bytes } = await assetBytes(o.orgId, o.avatarAssetId);
    const raw = o.engine === "ia" ? await generateVideo(bytes, asset.mime, animationPrompt(o)) : await photoToVideo(bytes, asset.mime);
    const clean = await finishVideo(raw, endCardLines(o));
    const preview = await applyWatermark(clean);
    const v = await store(o, clean, "video/mp4", `video-${o.number}-${o.videoRuns}.mp4`, `Vídeo nº ${o.number} (sem marca)`, "final");
    const p = await store(o, preview, "video/mp4", `previa-${o.number}-${o.videoRuns}.mp4`, `Prévia nº ${o.number} (com marca d'água)`, "previa");
    await setStatus(o.orgId, o.id, "video_pronto", { videoAssetId: v.id, previewAssetId: p.id, error: null });
  } catch (e) {
    console.error("[video] vídeo", o.id, (e as Error).message);
    await setStatus(o.orgId, o.id, "falhou", { error: friendly(e) }).catch(() => {});
  }
}

const RUN_FIELD = { gerar_avatar: "avatarRuns", gerar_video: "videoRuns" } as const;

/** Gera (ou refaz, com ajustes) o avatar ou o vídeo. Volta na hora; a geração segue em segundo plano. */
export async function startGeneration(user: SessionUser, id: string, action: "gerar_avatar" | "gerar_video", adjustments: string): Promise<Result<VideoOrder>> {
  const o = await loadOrder(user, id);
  if (!o) return fail("Pedido não encontrado.");
  if (!canDo(o, action)) return fail("Esta etapa não está disponível agora.");
  const e = env();
  const field = RUN_FIELD[action];
  if (o[field] >= e.VIDEO_MAX_REFACOES) return fail(`Limite de ${e.VIDEO_MAX_REFACOES} tentativas desta etapa no pedido. Crie um pedido novo se precisar.`);
  // O motor é decidido a cada geração: ligar as chaves no meio do pedido passa a usar a IA dali em diante.
  const engine = videoEngine();
  if (engine === "ia" && (await paidRunsThisMonth(user.orgId)) >= e.VIDEO_LIMITE_MES) {
    return fail(`Limite do mês atingido (${e.VIDEO_LIMITE_MES} gerações pagas). Aumente VIDEO_LIMITE_MES no Render se quiser continuar.`);
  }
  const next = await setStatus(user.orgId, o.id, action === "gerar_avatar" ? "gerando_avatar" : "gerando_video", {
    [field]: o[field] + 1,
    engine,
    error: null,
    adjustments: adjustments.trim().slice(0, 1000),
  });
  if (!next) return fail("Pedido não encontrado.");
  void (action === "gerar_avatar" ? avatarJob(next) : videoJob(next));
  await audit({ orgId: user.orgId, userId: user.id, action: `video.${action}`, entity: "video", entityId: o.id, details: `nº ${o.number} · ${engine}${adjustments ? " · com ajustes" : ""}` });
  return { ok: true, value: next };
}

// ---------------------------------------------------------------------------
// Envios ao cliente (sempre pelas travas do WhatsApp)
// ---------------------------------------------------------------------------
async function sendAssetToClient(user: SessionUser, o: VideoOrder, assetId: string | null, caption: string): Promise<Result<{ simulated: boolean }>> {
  const convId = o.conversationId ?? (await scoped(user.orgId)).conversations.find((c) => c.clientId === o.clientId)?.id;
  if (!convId) return fail("O cliente ainda não tem conversa no WhatsApp.");
  let target;
  try {
    target = await loadTarget(user, convId);
  } catch {
    return fail("Conversa não encontrada.");
  }
  if (!windowOpen(target.conv)) return fail("Fora da janela de 24h do WhatsApp: o cliente precisa mandar uma mensagem antes.");
  const { asset, bytes } = await assetBytes(user.orgId, assetId);
  const type = asset.type === "image" ? "image" : "video";
  const media: MessageMedia = { type, mime: asset.mime, filename: asset.filename, assetId: asset.id, caption };
  const decision = sendDecision(target.phone);
  if (decision.mode === "blocked") return fail(decision.reason);
  let simulated = true;
  let waMessageId: string;
  if (decision.mode === "live") {
    const creds = await waCredentials(user.orgId);
    if (!creds) return fail("Credenciais da Cloud API não configuradas.");
    try {
      media.id = await uploadMedia(creds.phoneNumberId, creds.token, new Blob([new Uint8Array(bytes)], { type: asset.mime }), asset.filename);
    } catch (err) {
      return fail(`Falha ao enviar o arquivo à Meta: ${err instanceof GraphError ? err.message : "erro de conexão"}`);
    }
    const r = await sendWhatsApp({ type: "media", to: target.phone, media: type, mediaId: media.id, caption }, { orgId: user.orgId });
    if (!r.ok) return fail(`Falha no envio: ${r.error}`);
    simulated = r.simulated;
    waMessageId = r.waMessageId;
  } else {
    waMessageId = `wamid.SIMULADO.${randomUUID()}`;
    media.simulated = true;
  }
  const label = type === "image" ? "imagem" : "vídeo";
  const err = await recordOutgoing(user, target.conv, `[${label}] ${caption}`.slice(0, 4096), simulated, waMessageId, { media });
  if (err) return fail(err);
  return { ok: true, value: { simulated } };
}

const CAPTIONS = {
  enviar_avatar: "Olha como ficou o seu avatar! Se quiser algum ajuste, é só falar. Se estiver tudo certo, responda \"pode continuar\" que já animamos o vídeo.",
  enviar_previa: "Seu vídeo ficou pronto! Esta é a prévia para aprovação. Assim que recebermos o comprovante de pagamento, enviamos o vídeo sem a marca d'água.",
  enviar_final: "Pagamento confirmado, obrigado! Aqui está o seu vídeo final, sem marca d'água. Sucesso nas corridas!",
} as const;

export async function sendStep(user: SessionUser, id: string, action: "enviar_avatar" | "enviar_previa" | "enviar_final"): Promise<Result<{ simulated: boolean }>> {
  const o = await loadOrder(user, id);
  if (!o) return fail("Pedido não encontrado.");
  if (!canDo(o, action)) return fail("Esta etapa não está disponível agora.");
  const assetId = action === "enviar_avatar" ? o.avatarAssetId : action === "enviar_previa" ? o.previewAssetId : o.videoAssetId;
  const r = await sendAssetToClient(user, o, assetId, CAPTIONS[action]);
  if (!r.ok) return r;
  const at = nowIso();
  if (action === "enviar_avatar") await setStatus(user.orgId, o.id, "avatar_enviado", { avatarSentAt: at });
  else if (action === "enviar_previa") await setStatus(user.orgId, o.id, "aguardando_pagamento", { previewSentAt: at });
  else await setStatus(user.orgId, o.id, "entregue", { deliveredAt: at });
  await audit({ orgId: user.orgId, userId: user.id, action: `video.${action}`, entity: "video", entityId: o.id, details: `nº ${o.number}${r.value.simulated ? " · simulado" : ""}` });
  return r;
}

/** Pagamento confirmado por uma pessoa (o reconhecimento automático do comprovante vem na fase 2). */
export async function confirmPayment(user: SessionUser, id: string): Promise<Result<VideoOrder>> {
  const o = await loadOrder(user, id);
  if (!o) return fail("Pedido não encontrado.");
  if (!canDo(o, "confirmar_pagamento")) return fail("Envie a prévia antes de confirmar o pagamento.");
  const next = await setStatus(user.orgId, o.id, "pago", { paidAt: nowIso() });
  await audit({ orgId: user.orgId, userId: user.id, action: "video.pagamento_confirmado", entity: "video", entityId: o.id, details: `nº ${o.number}` });
  return next ? { ok: true, value: next } : fail("Pedido não encontrado.");
}

export async function cancelOrder(user: SessionUser, id: string): Promise<Result<VideoOrder>> {
  const o = await loadOrder(user, id);
  if (!o) return fail("Pedido não encontrado.");
  if (!canDo(o, "cancelar")) return fail("Este pedido não pode mais ser cancelado.");
  if (user.role === "atendente") return fail("Só administradores e gestores cancelam pedidos.");
  const next = await setStatus(user.orgId, o.id, "cancelado");
  await audit({ orgId: user.orgId, userId: user.id, action: "video.cancelado", entity: "video", entityId: o.id, details: `nº ${o.number}` });
  return next ? { ok: true, value: next } : fail("Pedido não encontrado.");
}

export type { VideoAction };
