"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/session";
import { assignProduction, createProductionOrder, moveProduction, toggleChecklist } from "@/lib/business/service";
import { scoped } from "@/lib/data/repo";
import type { ProductionStage } from "@/lib/data/types";

export type ProdState = { error?: string; ok?: number | string } | undefined;

const STAGES: ProductionStage[] = ["fila", "producao", "revisao", "entregue", "cancelada"];

export async function moveProductionAction(formData: FormData) {
  const user = await authorize("production:manage");
  const to = String(formData.get("to")) as ProductionStage;
  if (!STAGES.includes(to)) throw new Error("Etapa inválida.");
  const r = await moveProduction(user, String(formData.get("id")), to);
  if (!r.ok) throw new Error(r.error);
  revalidatePath("/producao");
}

export async function toggleChecklistAction(formData: FormData) {
  const user = await authorize("production:manage");
  const r = await toggleChecklist(user, String(formData.get("id")), Number(formData.get("index")));
  if (!r.ok) throw new Error(r.error);
  revalidatePath("/producao");
}

export async function assignProductionAction(formData: FormData) {
  const user = await authorize("production:manage");
  const assigneeId = String(formData.get("assigneeId") ?? "") || null;
  if (assigneeId && !(await scoped(user.orgId)).users.some((u) => u.id === assigneeId && u.active)) throw new Error("Responsável inválido.");
  const r = await assignProduction(user, String(formData.get("id")), assigneeId);
  if (!r.ok) throw new Error(r.error);
  revalidatePath("/producao");
}

const schema = z.object({
  clientId: z.string().min(1, "Escolha o cliente.").max(64),
  title: z.string().trim().min(2, "Dê um título à ordem.").max(200),
  checklist: z.string().max(5000),
  dueDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
});

/** Ordem avulsa (sem venda), ex.: retrabalho ou cortesia. */
export async function createProductionAction(_: ProdState, formData: FormData): Promise<ProdState> {
  const user = await authorize("production:manage");
  const parsed = schema.safeParse(Object.fromEntries(["clientId", "title", "checklist", "dueDate"].map((k) => [k, String(formData.get(k) ?? "")])));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;
  const r = await createProductionOrder(user, { clientId: v.clientId, title: v.title, checklist: v.checklist.split("\n"), dueDate: v.dueDate || null, assigneeId: null });
  if (!r.ok) return { error: r.error };
  revalidatePath("/producao");
  return { ok: `Ordem nº ${r.value.number} criada na fila.` };
}
