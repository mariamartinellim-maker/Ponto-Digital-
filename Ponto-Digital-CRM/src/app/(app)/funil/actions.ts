"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, clientIp } from "@/lib/auth/session";
import { audit, now } from "@/lib/data/repo";
import { mutate } from "@/lib/data/store";
import { STAGES, type Stage } from "@/lib/data/types";
import { parseMoneyToCents } from "@/lib/format";

const stageIds = STAGES.map((s) => s.id) as [Stage, ...Stage[]];

export async function moveDealAction(dealId: string, stage: Stage) {
  const user = await authorize("deals:write");
  const target = z.enum(stageIds).parse(stage);
  const from = await mutate((db) => {
    const deal = db.deals.find((d) => d.id === dealId && d.orgId === user.orgId);
    if (!deal) throw new Error("Oportunidade não encontrada.");
    const prev = deal.stage;
    deal.stage = target;
    deal.updatedAt = now();
    deal.closedAt = target === "fechado" || target === "perdido" ? now() : null;
    return prev;
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "funil.etapa_alterada", entity: "oportunidade", entityId: dealId, details: `${from} → ${target}`, ip: await clientIp() });
  revalidatePath("/funil");
  revalidatePath("/dashboard");
}

export type DealFormState = { error?: string; ok?: boolean } | undefined;

export async function saveDealAction(_: DealFormState, formData: FormData): Promise<DealFormState> {
  const user = await authorize("deals:write");
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim().slice(0, 140);
  const clientId = String(formData.get("clientId") ?? "");
  const value = parseMoneyToCents(String(formData.get("value") ?? "0"));
  if (!title) return { error: "Informe o título." };
  if (value === null) return { error: "Valor inválido." };
  const ok = await mutate((db) => {
    if (id) {
      const deal = db.deals.find((d) => d.id === id && d.orgId === user.orgId);
      if (!deal) return false;
      Object.assign(deal, { title, valueCents: value, updatedAt: now() });
      return true;
    }
    const client = db.clients.find((c) => c.id === clientId && c.orgId === user.orgId);
    if (!client) return false;
    db.deals.unshift({ id: randomUUID(), orgId: user.orgId, clientId, title, valueCents: value, stage: "novo_lead", ownerId: user.id, createdAt: now(), updatedAt: now(), closedAt: null });
    return true;
  });
  if (!ok) return { error: "Registro não encontrado." };
  await audit({ orgId: user.orgId, userId: user.id, action: id ? "funil.oportunidade_editada" : "funil.oportunidade_criada", entity: "oportunidade", entityId: id || null, details: title, ip: await clientIp() });
  revalidatePath("/funil");
  return { ok: true };
}
