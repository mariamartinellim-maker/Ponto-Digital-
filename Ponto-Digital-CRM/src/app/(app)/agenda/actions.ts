"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSupabase, SUPABASE_PROXIMA_ETAPA } from "@/lib/supabase/server";
import { authorize, clientIp } from "@/lib/auth/session";
import { audit, now } from "@/lib/data/repo";
import { mutate } from "@/lib/data/store";
import { can } from "@/lib/permissions";

export type TaskState = { error?: string; ok?: number } | undefined;

const schema = z.object({
  title: z.string().trim().min(2, "Informe o título.").max(140),
  type: z.enum(["retorno", "ligacao", "reuniao", "proposta", "outro"]),
  clientId: z.string().max(64),
  assigneeId: z.string().max(64),
  // datetime-local (horário de Brasília, sem horário de verão desde 2019)
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Informe data e hora."),
  notes: z.string().max(2000),
});

export async function createTaskAction(_: TaskState, formData: FormData): Promise<TaskState> {
  const user = await authorize();
  if (isSupabase()) return { error: SUPABASE_PROXIMA_ETAPA };
  const parsed = schema.safeParse({
    title: formData.get("title") ?? "",
    type: formData.get("type") ?? "outro",
    clientId: formData.get("clientId") ?? "",
    assigneeId: formData.get("assigneeId") ?? "",
    dueAt: formData.get("dueAt") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;
  const assigneeId = can(user.role, "tasks:manage_all") && v.assigneeId ? v.assigneeId : user.id;
  const due = new Date(`${v.dueAt}:00-03:00`);
  if (Number.isNaN(due.getTime())) return { error: "Data inválida." };
  const err = await mutate((db) => {
    if (v.clientId && !db.clients.some((c) => c.id === v.clientId && c.orgId === user.orgId)) return "Cliente inválido.";
    if (!db.users.some((u) => u.id === assigneeId && u.orgId === user.orgId)) return "Responsável inválido.";
    db.tasks.push({ id: randomUUID(), orgId: user.orgId, title: v.title, type: v.type, clientId: v.clientId || null, assigneeId, dueAt: due.toISOString(), done: false, notes: v.notes, createdAt: now() });
    return null;
  });
  if (err) return { error: err };
  await audit({ orgId: user.orgId, userId: user.id, action: "tarefa.criada", entity: "tarefa", entityId: null, details: v.title, ip: await clientIp() });
  revalidatePath("/agenda");
  return { ok: Date.now() };
}

export async function toggleTaskAction(formData: FormData) {
  const user = await authorize();
  if (isSupabase()) throw new Error(SUPABASE_PROXIMA_ETAPA);
  const id = String(formData.get("id"));
  await mutate((db) => {
    const t = db.tasks.find((x) => x.id === id && x.orgId === user.orgId);
    if (!t) return;
    if (t.assigneeId !== user.id && !can(user.role, "tasks:manage_all")) throw new Error("Sem permissão.");
    t.done = !t.done;
  });
  revalidatePath("/agenda");
}

export async function deleteTaskAction(formData: FormData) {
  const user = await authorize();
  if (isSupabase()) throw new Error(SUPABASE_PROXIMA_ETAPA);
  const id = String(formData.get("id"));
  await mutate((db) => {
    const t = db.tasks.find((x) => x.id === id && x.orgId === user.orgId);
    if (!t) return;
    if (t.assigneeId !== user.id && !can(user.role, "tasks:manage_all")) throw new Error("Sem permissão.");
    db.tasks = db.tasks.filter((x) => x !== t);
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "tarefa.excluida", entity: "tarefa", entityId: id, ip: await clientIp() });
  revalidatePath("/agenda");
}
