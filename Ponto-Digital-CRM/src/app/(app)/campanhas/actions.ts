"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isSupabase, SUPABASE_PROXIMA_ETAPA } from "@/lib/supabase/server";
import { authorize, clientIp } from "@/lib/auth/session";
import { appendMessage, applyWhatsAppEvents, audit, now, scoped } from "@/lib/data/repo";
import { getDb, mutate } from "@/lib/data/store";
import { STAGES, type Segment, type Stage } from "@/lib/data/types";
import { env } from "@/lib/env";
import { renderTemplate, resolveAudience } from "@/lib/segmentation";
import { sendWhatsApp } from "@/lib/whatsapp/client";
import type { WaEnvelope } from "@/lib/whatsapp/events";

const segmentSchema = z.object({
  cities: z.array(z.string().max(80)).max(50),
  services: z.array(z.string().max(80)).max(50),
  stages: z.array(z.enum(STAGES.map((s) => s.id) as [Stage, ...Stage[]])).max(5),
  tags: z.array(z.string().max(40)).max(50),
});

export async function previewAudienceAction(segment: Segment) {
  const user = await authorize("campaigns:manage");
  const seg = segmentSchema.parse(segment);
  const d = await scoped(user.orgId);
  const a = resolveAudience(seg, d.clients, d.deals);
  return {
    eligible: a.eligible.length,
    noConsent: a.excludedNoConsent.length,
    optOut: a.excludedOptOut.length,
    sample: a.eligible.slice(0, 5).map((c) => c.name),
  };
}

export type CampaignFormState = { error?: string } | undefined;

export async function createCampaignAction(_: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  const user = await authorize("campaigns:manage");
  if (isSupabase()) return { error: SUPABASE_PROXIMA_ETAPA };
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const templateId = String(formData.get("templateId") ?? "");
  if (name.length < 3) return { error: "Dê um nome à campanha." };
  const seg = segmentSchema.safeParse({
    cities: formData.getAll("cities").map(String),
    services: formData.getAll("services").map(String),
    stages: formData.getAll("stages").map(String),
    tags: formData.getAll("tags").map(String),
  });
  if (!seg.success) return { error: "Segmentação inválida." };
  const db = await getDb();
  const tpl = db.templates.find((t) => t.id === templateId && t.orgId === user.orgId);
  if (!tpl || tpl.status !== "APPROVED") return { error: "Selecione um modelo aprovado pela Meta." };

  const id = randomUUID();
  await mutate((d) => {
    d.campaigns.unshift({ id, orgId: user.orgId, name, templateId, segment: seg.data, mode: "simulacao", status: "rascunho", createdBy: user.id, createdAt: now(), executedAt: null, excludedNoConsent: 0, excludedOptOut: 0, recipients: [] });
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "campanha.criada", entity: "campanha", entityId: id, details: name, ip: await clientIp() });
  redirect(`/campanhas/${id}`);
}

/**
 * Executa a campanha. NESTA VERSÃO É SEMPRE SIMULADA: nenhuma mensagem sai para o WhatsApp.
 * O público é recalculado no momento da execução (respeita descadastros recentes).
 */
export async function runCampaignAction(formData: FormData) {
  const user = await authorize("campaigns:manage");
  if (isSupabase()) throw new Error(SUPABASE_PROXIMA_ETAPA);
  const id = String(formData.get("id"));
  if (formData.get("confirm") !== "on") throw new Error("Confirme a execução.");
  if (env().WHATSAPP_CAMPAIGNS_LIVE) {
    throw new Error("Envio real de campanhas não está liberado nesta versão. Mantenha WHATSAPP_CAMPAIGNS_LIVE=false.");
  }
  const db = await getDb();
  const camp = db.campaigns.find((c) => c.id === id && c.orgId === user.orgId);
  if (!camp || camp.status !== "rascunho") throw new Error("Campanha não pode ser executada.");
  const tpl = db.templates.find((t) => t.id === camp.templateId);
  if (!tpl || tpl.status !== "APPROVED") throw new Error("Modelo não aprovado.");
  const audience = resolveAudience(camp.segment, db.clients.filter((c) => c.orgId === user.orgId), db.deals.filter((d) => d.orgId === user.orgId));

  const sends: { client: (typeof audience.eligible)[number]; vars: string[]; r: Awaited<ReturnType<typeof sendWhatsApp>> }[] = [];
  for (const client of audience.eligible) {
    const vars = [client.name.split(" ")[0] ?? client.name, "em breve"].slice(0, (tpl.body.match(/\{\{\d+\}\}/g) ?? []).length);
    const r = await sendWhatsApp({ type: "template", to: client.phone, name: tpl.name, language: tpl.language, variables: vars }, { campaign: true });
    sends.push({ client, vars, r });
  }

  await mutate((d) => {
    camp.status = "concluida";
    camp.executedAt = now();
    camp.mode = "simulacao";
    camp.excludedNoConsent = audience.excludedNoConsent.length;
    camp.excludedOptOut = audience.excludedOptOut.length;
    camp.recipients = sends.map(({ client, r }) => ({
      clientId: client.id,
      status: r.ok ? "simulada" : "falhou",
      waMessageId: r.ok ? r.waMessageId : null,
    }));
    for (const { client, vars, r } of sends) {
      if (!r.ok) continue;
      let conv = d.conversations.find((c) => c.clientId === client.id && c.orgId === user.orgId);
      if (!conv) {
        conv = { id: randomUUID(), orgId: user.orgId, clientId: client.id, assigneeId: client.ownerId, status: "resolvida", unread: 0, lastMessageAt: now(), lastInboundAt: null };
        d.conversations.push(conv);
      }
      appendMessage(d, conv, { direction: "out", origin: "campanha", body: renderTemplate(tpl.body, vars), status: "simulada", waMessageId: r.waMessageId, authorId: user.id });
    }
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "campanha.executada_simulacao", entity: "campanha", entityId: id, details: `${sends.length} destinatários (simulado); ${audience.excludedNoConsent.length} sem consentimento e ${audience.excludedOptOut.length} descadastrados excluídos.`, ip: await clientIp() });
  revalidatePath(`/campanhas/${id}`);
  revalidatePath("/campanhas");
}

/**
 * MODO DEMO: gera atualizações de status como a Meta enviaria por webhook
 * (sent → delivered → read / failed) e processa pelo mesmo pipeline do webhook real.
 */
export async function simulateStatusesAction(formData: FormData) {
  const user = await authorize("campaigns:manage");
  if (isSupabase()) throw new Error(SUPABASE_PROXIMA_ETAPA);
  const id = String(formData.get("id"));
  const db = await getDb();
  const camp = db.campaigns.find((c) => c.id === id && c.orgId === user.orgId);
  if (!camp) throw new Error("Campanha não encontrada.");
  const ts = Math.floor(Date.now() / 1000);
  const env: WaEnvelope = { phoneNumberId: "DEMO", displayPhone: null, field: "messages", events: [] };
  camp.recipients.forEach((r, i) => {
    if (!r.waMessageId) return;
    const roll = (i * 37 + 11) % 100;
    const chain: ("sent" | "delivered" | "read" | "failed")[] = roll < 6 ? ["failed"] : roll < 30 ? ["sent", "delivered"] : ["sent", "delivered", "read"];
    for (const status of chain) {
      env.events.push({ kind: "status", waMessageId: r.waMessageId, status, recipient: "", timestamp: ts, error: status === "failed" ? "Simulação de falha de entrega" : null });
    }
  });
  await applyWhatsAppEvents(user.orgId, [env]);
  revalidatePath(`/campanhas/${id}`);
}

export async function cancelCampaignAction(formData: FormData) {
  const user = await authorize("campaigns:manage");
  if (isSupabase()) throw new Error(SUPABASE_PROXIMA_ETAPA);
  const id = String(formData.get("id"));
  await mutate((db) => {
    const camp = db.campaigns.find((c) => c.id === id && c.orgId === user.orgId);
    if (camp && camp.status === "rascunho") camp.status = "cancelada";
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "campanha.cancelada", entity: "campanha", entityId: id, ip: await clientIp() });
  revalidatePath(`/campanhas/${id}`);
}
