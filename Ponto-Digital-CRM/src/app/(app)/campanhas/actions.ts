"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { dbError, isSupabase, supabaseServer } from "@/lib/supabase/server";
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
  if (isSupabase()) {
    const tpl = (await scoped(user.orgId)).templates.find((t) => t.id === templateId);
    if (!tpl || tpl.status !== "APPROVED") return { error: "Selecione um modelo aprovado pela Meta." };
    const sb = await supabaseServer();
    const { data, error } = await sb
      .from("campaigns")
      .insert({ org_id: user.orgId, name, template_id: templateId, segment: seg.data, created_by: user.id })
      .select("id")
      .single();
    if (error || !data) return { error: dbError(error) };
    await audit({ orgId: user.orgId, userId: user.id, action: "campanha.criada", entity: "campanha", entityId: String(data.id), details: name });
    redirect(`/campanhas/${data.id}`);
  }
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

/** Limite por execução no envio real (os números novos na Meta começam com 250 contatos/dia). */
const LIVE_CAMPAIGN_CAP = 250;

/**
 * Supabase: executa a campanha. Simulada por padrão; envio real só com WHATSAPP_SEND_MODE=live E
 * WHATSAPP_CAMPAIGNS_LIVE=true (e, no ambiente de teste, apenas para os números de teste).
 * O público é recalculado agora; o banco recusa qualquer destinatário sem opt-in.
 */
async function runCampaignSupabase(user: Awaited<ReturnType<typeof authorize>>, id: string) {
  const d = await scoped(user.orgId);
  const camp = d.campaigns.find((c) => c.id === id);
  if (!camp || camp.status !== "rascunho") throw new Error("Campanha não pode ser executada.");
  const tpl = d.templates.find((t) => t.id === camp.templateId);
  if (!tpl || tpl.status !== "APPROVED") throw new Error("Modelo não aprovado.");
  const audience = resolveAudience(camp.segment, d.clients, d.deals);
  const live = env().WHATSAPP_SEND_MODE === "live" && env().WHATSAPP_CAMPAIGNS_LIVE;
  if (live && audience.eligible.length > LIVE_CAMPAIGN_CAP) {
    throw new Error(`Envio real limitado a ${LIVE_CAMPAIGN_CAP} contatos por execução. Divida o público em campanhas menores.`);
  }
  const sb = await supabaseServer();
  const varCount = (tpl.body.match(/\{\{\d+\}\}/g) ?? []).length;
  let sent = 0;
  let simulated = 0;
  let failed = 0;
  for (const client of audience.eligible) {
    const vars = [client.name.split(" ")[0] ?? client.name, "em breve"].slice(0, varCount);
    const r = await sendWhatsApp({ type: "template", to: client.phone, name: tpl.name, language: tpl.language, variables: vars }, { campaign: true, orgId: user.orgId });
    const status = !r.ok ? "falhou" : r.simulated ? "simulada" : "enviada";
    const { error } = await sb.from("campaign_recipients").insert({ campaign_id: id, org_id: user.orgId, client_id: client.id, status, wa_message_id: r.ok ? r.waMessageId : null });
    if (error) {
      failed++;
      continue;
    }
    if (!r.ok) {
      failed++;
      continue;
    }
    if (r.simulated) simulated++;
    else sent++;
    let convId = d.conversations.find((c) => c.clientId === client.id)?.id;
    if (!convId) {
      const { data } = await sb.from("conversations").insert({ org_id: user.orgId, client_id: client.id, assignee_id: client.ownerId, status: "resolvida" }).select("id").maybeSingle();
      convId = data?.id ? String(data.id) : undefined;
    }
    if (convId) {
      await sb.from("messages").insert({ org_id: user.orgId, conversation_id: convId, direction: "out", origin: "campanha", body: renderTemplate(tpl.body, vars), status: r.simulated ? "simulada" : "enviada", wa_message_id: r.waMessageId, author_id: user.id });
    }
    if (!r.simulated) await new Promise((res) => setTimeout(res, 50)); // ritmo seguro para a Meta
  }
  const { error } = await sb
    .from("campaigns")
    .update({ status: "concluida", executed_at: now(), excluded_no_consent: audience.excludedNoConsent.length, excluded_opt_out: audience.excludedOptOut.length })
    .eq("id", id);
  if (error) throw new Error(dbError(error));
  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: sent ? "campanha.executada_envio_real" : "campanha.executada_simulacao",
    entity: "campanha",
    entityId: id,
    details: `${sent} enviados, ${simulated} simulados, ${failed} falhas; ${audience.excludedNoConsent.length} sem consentimento e ${audience.excludedOptOut.length} descadastrados excluídos.`,
    ip: await clientIp(),
  });
}

/**
 * Executa a campanha. No modo demonstração é SEMPRE simulada: nenhuma mensagem sai para o WhatsApp.
 * O público é recalculado no momento da execução (respeita descadastros recentes).
 */
export async function runCampaignAction(formData: FormData) {
  const user = await authorize("campaigns:manage");
  const id = String(formData.get("id"));
  if (formData.get("confirm") !== "on") throw new Error("Confirme a execução.");
  if (isSupabase()) {
    await runCampaignSupabase(user, id);
    revalidatePath(`/campanhas/${id}`);
    revalidatePath("/campanhas");
    return;
  }
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
  if (isSupabase()) throw new Error("No Supabase, os status chegam pelos webhooks reais da Meta.");
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
  const id = String(formData.get("id"));
  if (isSupabase()) {
    const sb = await supabaseServer();
    const { error } = await sb.from("campaigns").update({ status: "cancelada" }).eq("id", id).eq("status", "rascunho");
    if (error) throw new Error(dbError(error));
  } else {
    await mutate((db) => {
      const camp = db.campaigns.find((c) => c.id === id && c.orgId === user.orgId);
      if (camp && camp.status === "rascunho") camp.status = "cancelada";
    });
  }
  await audit({ orgId: user.orgId, userId: user.id, action: "campanha.cancelada", entity: "campanha", entityId: id, ip: await clientIp() });
  revalidatePath(`/campanhas/${id}`);
}
