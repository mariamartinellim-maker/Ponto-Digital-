"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/session";
import { cancelOrder, confirmPayment, createVideoOrder, sendStep, startGeneration } from "@/lib/video/service";

export type VideoState = { error?: string; ok?: number | string } | undefined;

const schema = z.object({
  clientId: z.string().min(1, "Escolha o cliente.").max(64),
  modality: z.enum(["uber", "taxi"], { message: "Escolha Uber ou Táxi." }),
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
