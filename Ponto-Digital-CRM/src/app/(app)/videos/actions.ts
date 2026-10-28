"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/session";
import { getOne } from "@/lib/data/collections";
import { audit } from "@/lib/data/repo";
import type { VideoModality } from "@/lib/data/types";
import { normalizePixKey } from "@/lib/pix";
import { saveSettings, setConversationStage } from "@/lib/video/autopilot";
import { MODALITIES } from "@/lib/video/rules";
import { cancelOrder, confirmPayment, createVideoOrder, sendStep, startGeneration } from "@/lib/video/service";

export type VideoState = { error?: string; ok?: number | string } | undefined;

const schema = z.object({
  clientId: z.string().min(1, "Escolha o cliente.").max(64),
  modality: z.enum(MODALITIES as [VideoModality, ...VideoModality[]], { message: "Escolha o segmento do motorista." }),
  driverGender: z.enum(["masculino", "feminino"], { message: "Escolha motorista homem ou mulher." }),
  driverName: z.string().max(80),
  city: z.string().max(80).default(""),
  speech: z.string().max(400),
  contactPhone: z.string().max(30).default(""),
});

export async function createVideoAction(_: VideoState, formData: FormData): Promise<VideoState> {
  const user = await authorize("videos:manage");
  const parsed = schema.safeParse(Object.fromEntries(["clientId", "modality", "driverGender", "driverName", "city", "speech", "contactPhone"].map((k) => [k, String(formData.get(k) ?? "")])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Anexe a foto do cliente." };
  const r = await createVideoOrder(user, {
    ...parsed.data,
    photo: { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, filename: file.name || "foto.jpg" },
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/videos");
  return { ok: `Pedido nº ${r.value.number} criado. Agora gere o avatar.` };
}

const STEPS = ["gerar_avatar", "gerar_video", "enviar_avatar", "enviar_previa", "enviar_final", "confirmar_pagamento", "cancelar"] as const;

export async function videoStepAction(_: VideoState, formData: FormData): Promise<VideoState> {
  const user = await authorize("videos:manage");
  const id = String(formData.get("id"));
  const step = String(formData.get("step")) as (typeof STEPS)[number];
  if (!STEPS.includes(step)) return { error: "Ação inválida." };
  let msg: string;
  if (step === "gerar_avatar" || step === "gerar_video") {
    const r = await startGeneration(user, id, step, String(formData.get("adjustments") ?? ""));
    if (!r.ok) return { error: r.error };
    msg = `${step === "gerar_avatar" ? "Avatar" : "Vídeo"} sendo gerado${r.value.engine === "simulador" ? " no simulador (sem IA, sem custo)" : " pela IA"}. A tela atualiza sozinha.`;
  } else if (step === "confirmar_pagamento") {
    const r = await confirmPayment(user, id);
    if (!r.ok) return { error: r.error };
    msg = "Pagamento confirmado. Agora envie o vídeo final.";
  } else if (step === "cancelar") {
    const r = await cancelOrder(user, id);
    if (!r.ok) return { error: r.error };
    msg = "Pedido cancelado.";
  } else {
    const r = await sendStep(user, id, step);
    if (!r.ok) return { error: r.error };
    msg = r.value.simulated ? "Registrado na conversa (envio simulado: nada saiu para o WhatsApp)." : "Enviado ao cliente pelo WhatsApp.";
  }
  revalidatePath("/videos");
  return { ok: msg };
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  trigger: z.enum(["anuncio", "contato_novo"]),
  testOnly: z.boolean(),
  priceText: z.string().trim().max(300),
  pixKey: z.string().trim().max(120),
  pixHolder: z.string().trim().max(60),
  pixCity: z.string().trim().max(40),
  audioAskAssetId: z.string().uuid().nullable(),
  audioPhotoAssetId: z.string().uuid().nullable(),
});

/** Configuração do atendimento automático (admin e gestor). */
export async function saveAutopilotAction(_: VideoState, formData: FormData): Promise<VideoState> {
  const user = await authorize("videos:manage");
  if (user.role === "atendente") return { error: "Só administradores e gestores configuram o atendimento automático." };
  const audio = (k: string) => String(formData.get(k) ?? "") || null;
  const parsed = settingsSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    trigger: String(formData.get("trigger") ?? "anuncio"),
    testOnly: formData.get("testOnly") === "on",
    priceText: String(formData.get("priceText") ?? ""),
    pixKey: String(formData.get("pixKey") ?? ""),
    pixHolder: String(formData.get("pixHolder") ?? ""),
    pixCity: String(formData.get("pixCity") ?? "") || "Cuiaba",
    audioAskAssetId: audio("audioAskAssetId"),
    audioPhotoAssetId: audio("audioPhotoAssetId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const s = parsed.data;
  if (s.enabled && (!s.priceText || !s.pixKey)) return { error: "Para ligar, informe o valor e a chave Pix (vão na mensagem de pagamento)." };
  if (s.pixKey && !normalizePixKey(s.pixKey)) return { error: "Chave Pix inválida (use CPF, CNPJ, e-mail, +55 com DDD ou chave aleatória)." };
  for (const id of [s.audioAskAssetId, s.audioPhotoAssetId]) {
    if (id && (await getOne(user.orgId, "mediaAssets", id))?.type !== "audio") return { error: "Escolha um áudio da biblioteca." };
  }
  await saveSettings(user.orgId, user.id, s);
  await audit({ orgId: user.orgId, userId: user.id, action: "video.robo_configurado", entity: "video", entityId: null, details: `${s.enabled ? "ligado" : "desligado"} · ${s.testOnly ? "só números de teste" : "todos os clientes"} · gatilho ${s.trigger}` });
  revalidatePath("/videos");
  return { ok: s.enabled ? "Atendimento automático LIGADO." : "Configuração salva (atendimento automático desligado)." };
}

export async function autopilotConversationAction(formData: FormData) {
  const user = await authorize("videos:manage");
  const action = String(formData.get("action"));
  if (action !== "pausar" && action !== "reiniciar") throw new Error("Ação inválida.");
  if (action === "reiniciar" && user.role === "atendente") throw new Error("Só administradores e gestores reiniciam o robô.");
  if (!(await setConversationStage(user.orgId, String(formData.get("id")), action))) throw new Error("Conversa não encontrada.");
  await audit({ orgId: user.orgId, userId: user.id, action: `video.robo_${action}`, entity: "conversa", entityId: null, details: "" });
  revalidatePath("/videos");
}
