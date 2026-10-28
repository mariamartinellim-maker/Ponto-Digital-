import "server-only";
import { randomUUID } from "node:crypto";
import type { SessionUser } from "../auth/session";
import { getOne, insertOne, listAll, nextNumber, updateOne, type Access } from "../data/collections";
import { audit, scoped } from "../data/repo";
import type { MediaAsset, VideoModality, VideoOrder, VideoOrderStatus } from "../data/types";
import { env } from "../env";
import { getFile, saveAsset } from "../media/storage";
import { applyWatermark, finishVideo, photoToVideo, toJpeg } from "./ffmpeg";
import { sendToConversation } from "./outbox";
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

/** Quem age: uma pessoa logada (botões da tela) ou o próprio sistema (atendimento automático). */
export type Actor = SessionUser | { system: true; orgId: string };
export const SYSTEM = (orgId: string): Actor => ({ system: true, orgId });
const userOf = (a: Actor): SessionUser | null => ("system" in a ? null : a);
const accessOf = (a: Actor): Access | undefined => ("system" in a ? SERVER : undefined);

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

async function loadOrder(a: Actor, id: string) {
  const o = await getOne(a.orgId, "videoOrders", id, accessOf(a));
  return o ? withStuck(o) : null;
}

async function setStatus(orgId: string, id: string, status: VideoOrderStatus, patch: Partial<VideoOrder> = {}) {
  return updateOne(orgId, "videoOrders", id, { status, updatedAt: nowIso(), ...patch }, SERVER);
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------
export interface OrderInput {
  modality: string;
  driverGender: string;
  driverName: string;
  city: string;
  speech: string;
  contactPhone: string;
}

/** Cria o pedido com a foto já salva na biblioteca (usado pela tela e pelo atendimento automático). */
export async function createOrderCore(
  a: Actor,
  client: { id: string; name: string; phone: string; city: string },
  conversationId: string | null,
  input: OrderInput,
  photoAssetId: string,
  autopilot = false,
): Promise<Result<VideoOrder>> {
  const err = validateOrderInput(input);
  if (err) return fail(err);
  const user = userOf(a);
  const order: VideoOrder = {
    id: randomUUID(),
    orgId: a.orgId,
    number: await nextNumber(a.orgId, "videoOrders", accessOf(a)),
    clientId: client.id,
    conversationId,
    modality: input.modality as VideoModality,
    driverName: input.driverName.trim().slice(0, 80),
    driverGender: input.driverGender === "feminino" ? "feminino" : "masculino",
    city: (input.city.trim() || client.city).slice(0, 80),
    speech: input.speech.trim().slice(0, 400),
    // O cliente é o próprio motorista: sem número informado, o vídeo mostra o WhatsApp dele.
    contactPhone: (input.contactPhone.trim() || client.phone).slice(0, 30),
    adjustments: "",
    status: "foto_recebida",
    photoAssetId,
    avatarAssetId: null,
    videoAssetId: null,
    previewAssetId: null,
    receiptAssetId: null,
    avatarRuns: 0,
    videoRuns: 0,
    engine: videoEngine(),
    autopilot,
    error: null,
    createdBy: user?.id ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    avatarSentAt: null,
    previewSentAt: null,
    paidAt: null,
    deliveredAt: null,
  };
  try {
    const saved = await insertOne("videoOrders", order, SERVER);
    await audit({ orgId: a.orgId, userId: user?.id ?? null, action: "video.pedido_criado", entity: "video", entityId: saved.id, details: `nº ${saved.number} · ${client.name}${autopilot ? " · automático" : ""}` });
    return { ok: true, value: saved };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function createVideoOrder(
  user: SessionUser,
  input: OrderInput & { clientId: string; conversationId?: string | null; photo: { bytes: Uint8Array; mime: string; filename: string } },
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
  return createOrderCore(user, client, conv?.id ?? null, input, photo.id);
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
    const ready = await setStatus(o.orgId, o.id, "avatar_pronto", { avatarAssetId: saved.id, error: null });
    if (ready?.autopilot) await (await import("./autopilot")).onAvatarReady(ready).catch((e: unknown) => console.error("[robô] avatar pronto:", (e as Error).message));
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
    const ready = await setStatus(o.orgId, o.id, "video_pronto", { videoAssetId: v.id, previewAssetId: p.id, error: null });
    if (ready?.autopilot) await (await import("./autopilot")).onVideoReady(ready).catch((e: unknown) => console.error("[robô] vídeo pronto:", (e as Error).message));
  } catch (e) {
    console.error("[video] vídeo", o.id, (e as Error).message);
    await setStatus(o.orgId, o.id, "falhou", { error: friendly(e) }).catch(() => {});
  }
}

const RUN_FIELD = { gerar_avatar: "avatarRuns", gerar_video: "videoRuns" } as const;

/** Gera (ou refaz, com ajustes) o avatar ou o vídeo. Volta na hora; a geração segue em segundo plano. */
export async function startGeneration(a: Actor, id: string, action: "gerar_avatar" | "gerar_video", adjustments: string): Promise<Result<VideoOrder>> {
  const o = await loadOrder(a, id);
  if (!o) return fail("Pedido não encontrado.");
  if (!canDo(o, action)) return fail("Esta etapa não está disponível agora.");
  const e = env();
  const field = RUN_FIELD[action];
  if (o[field] >= e.VIDEO_MAX_REFACOES) return fail(`Limite de ${e.VIDEO_MAX_REFACOES} tentativas desta etapa no pedido. Crie um pedido novo se precisar.`);
  // O motor é decidido a cada geração: ligar as chaves no meio do pedido passa a usar a IA dali em diante.
  const engine = videoEngine();
  if (engine === "ia" && (await paidRunsThisMonth(a.orgId)) >= e.VIDEO_LIMITE_MES) {
    return fail(`Limite do mês atingido (${e.VIDEO_LIMITE_MES} gerações pagas). Aumente VIDEO_LIMITE_MES no Render se quiser continuar.`);
  }
  const next = await setStatus(a.orgId, o.id, action === "gerar_avatar" ? "gerando_avatar" : "gerando_video", {
    [field]: o[field] + 1,
    engine,
    error: null,
    adjustments: adjustments.trim().slice(0, 1000),
  });
  if (!next) return fail("Pedido não encontrado.");
  void (action === "gerar_avatar" ? avatarJob(next) : videoJob(next));
  await audit({ orgId: a.orgId, userId: userOf(a)?.id ?? null, action: `video.${action}`, entity: "video", entityId: o.id, details: `nº ${o.number} · ${engine}${adjustments ? " · com ajustes" : ""}` });
  return { ok: true, value: next };
}

// ---------------------------------------------------------------------------
// Envios ao cliente (sempre pelas travas do WhatsApp)
// ---------------------------------------------------------------------------
async function sendAssetToClient(user: SessionUser | null, o: VideoOrder, assetId: string | null, caption: string): Promise<Result<{ simulated: boolean }>> {
  const convId = o.conversationId ?? (user ? (await scoped(o.orgId)).conversations.find((c) => c.clientId === o.clientId)?.id : null);
  if (!convId) return fail("O cliente ainda não tem conversa no WhatsApp.");
  if (!assetId) return fail("Arquivo do pedido não encontrado.");
  return sendToConversation(o.orgId, convId, { kind: "asset", assetId, caption }, user);
}

const CAPTIONS = {
  enviar_avatar: "Olha como ficou! Se quiser mudar alguma coisa é só falar. Se tiver tudo certo me responde \"pode continuar\"",
  enviar_previa: "Prontinho, essa é a prévia pra você conferir",
  enviar_final: "Prontinho! Aqui está o seu vídeo sem a marca d'água. Sucesso nas corridas!",
} as const;

export async function sendStep(a: Actor, id: string, action: "enviar_avatar" | "enviar_previa" | "enviar_final"): Promise<Result<{ simulated: boolean }>> {
  const o = await loadOrder(a, id);
  if (!o) return fail("Pedido não encontrado.");
  if (!canDo(o, action)) return fail("Esta etapa não está disponível agora.");
  const assetId = action === "enviar_avatar" ? o.avatarAssetId : action === "enviar_previa" ? o.previewAssetId : o.videoAssetId;
  const r = await sendAssetToClient(userOf(a), o, assetId, CAPTIONS[action]);
  if (!r.ok) return r;
  const at = nowIso();
  if (action === "enviar_avatar") await setStatus(a.orgId, o.id, "avatar_enviado", { avatarSentAt: at });
  else if (action === "enviar_previa") await setStatus(a.orgId, o.id, "aguardando_pagamento", { previewSentAt: at });
  else await setStatus(a.orgId, o.id, "entregue", { deliveredAt: at });
  await audit({ orgId: a.orgId, userId: userOf(a)?.id ?? null, action: `video.${action}`, entity: "video", entityId: o.id, details: `nº ${o.number}${r.value.simulated ? " · simulado" : ""}` });
  return r;
}

/** Pagamento confirmado: por uma pessoa (botão) ou pelo robô, ao ler um comprovante enviado pelo cliente. */
export async function confirmPayment(a: Actor, id: string, receiptAssetId: string | null = null): Promise<Result<VideoOrder>> {
  const o = await loadOrder(a, id);
  if (!o) return fail("Pedido não encontrado.");
  if (!canDo(o, "confirmar_pagamento")) return fail("Envie a prévia antes de confirmar o pagamento.");
  const next = await setStatus(a.orgId, o.id, "pago", { paidAt: nowIso(), ...(receiptAssetId ? { receiptAssetId } : {}) });
  await audit({ orgId: a.orgId, userId: userOf(a)?.id ?? null, action: "video.pagamento_confirmado", entity: "video", entityId: o.id, details: `nº ${o.number}${receiptAssetId ? " · comprovante lido automaticamente" : ""}` });
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
