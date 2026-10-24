"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize, clientIp } from "@/lib/auth/session";
import { analyzeCsv, type ImportAnalysis } from "@/lib/csv";
import { audit, findClientByPhone, now, setConsent } from "@/lib/data/repo";
import { getDb, mutate } from "@/lib/data/store";
import { normalizePhone } from "@/lib/phone";

export type ClientFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

const clientSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(120),
  phone: z.string().trim().min(8, "Informe o telefone."),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("E-mail inválido.").max(160)]),
  city: z.string().trim().max(80),
  services: z.array(z.string().max(60)).max(15),
  tags: z.string().max(200),
  notes: z.string().max(4000),
  ownerId: z.string().max(64),
});

function parseClientForm(formData: FormData) {
  return clientSchema.safeParse({
    name: formData.get("name") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    city: formData.get("city") ?? "",
    services: formData.getAll("services").map(String),
    tags: formData.get("tags") ?? "",
    notes: formData.get("notes") ?? "",
    ownerId: formData.get("ownerId") ?? "",
  });
}

const tagsFrom = (s: string) =>
  [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 10).map((t) => t.slice(0, 30));

export async function saveClientAction(_: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const user = await authorize("clients:write");
  const id = String(formData.get("id") ?? "");
  const parsed = parseClientForm(formData);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { error: "Revise os campos destacados.", fieldErrors };
  }
  const v = parsed.data;
  const phone = normalizePhone(v.phone);
  if (!phone) return { error: "Telefone inválido.", fieldErrors: { phone: "Use DDD + número, ex.: (11) 99999-0000" } };

  const db = await getDb();
  const dup = findClientByPhone(db, user.orgId, phone);
  if (dup && dup.id !== id) {
    return { error: `Já existe um cliente com este telefone: ${dup.name}.`, fieldErrors: { phone: "Telefone já cadastrado" } };
  }
  const ownerOk = !v.ownerId || db.users.some((u) => u.id === v.ownerId && u.orgId === user.orgId);
  const ownerId = ownerOk && v.ownerId ? v.ownerId : null;
  const consentChecked = formData.get("consent") === "on";

  let clientId = id;
  if (id) {
    const client = db.clients.find((c) => c.id === id && c.orgId === user.orgId);
    if (!client) return { error: "Cliente não encontrado." };
    await mutate(() => {
      Object.assign(client, { name: v.name, phone, email: v.email, city: v.city, services: v.services, tags: tagsFrom(v.tags), notes: v.notes, ownerId, updatedAt: now() });
    });
    await audit({ orgId: user.orgId, userId: user.id, action: "cliente.editado", entity: "cliente", entityId: id, ip: await clientIp() });
  } else {
    clientId = randomUUID();
    await mutate((d) => {
      const t = now();
      const client = {
        id: clientId,
        orgId: user.orgId,
        name: v.name,
        phone,
        email: v.email,
        city: v.city,
        services: v.services,
        tags: tagsFrom(v.tags),
        notes: v.notes,
        ownerId: ownerId ?? user.id,
        consent: { status: "desconhecido" as const, source: null, at: null },
        createdAt: t,
        updatedAt: t,
        lastContactAt: null,
      };
      d.clients.unshift(client);
      d.deals.unshift({ id: randomUUID(), orgId: user.orgId, clientId, title: "Nova oportunidade", valueCents: 0, stage: "novo_lead", ownerId: client.ownerId, createdAt: t, updatedAt: t, closedAt: null });
      if (consentChecked) setConsent(d, client, "opt_in", "manual", "Consentimento registrado no cadastro.", user.id);
    });
    await audit({ orgId: user.orgId, userId: user.id, action: "cliente.criado", entity: "cliente", entityId: clientId, ip: await clientIp() });
  }
  revalidatePath("/clientes");
  redirect(`/clientes/${clientId}`);
}

export async function updateConsentAction(formData: FormData) {
  const user = await authorize("clients:write");
  const id = String(formData.get("id"));
  const status = formData.get("status") === "opt_in" ? "opt_in" : "opt_out";
  const note = String(formData.get("note") ?? "").slice(0, 500) || (status === "opt_in" ? "Consentimento confirmado pelo cliente." : "Descadastro solicitado.");
  await mutate((db) => {
    const client = db.clients.find((c) => c.id === id && c.orgId === user.orgId);
    if (!client) throw new Error("Cliente não encontrado.");
    setConsent(db, client, status, "manual", note, user.id);
  });
  await audit({ orgId: user.orgId, userId: user.id, action: status === "opt_in" ? "consentimento.opt_in" : "consentimento.opt_out", entity: "cliente", entityId: id, details: note, ip: await clientIp() });
  revalidatePath(`/clientes/${id}`);
}

/** LGPD — direito de eliminação: anonimiza dados pessoais mantendo apenas registros estatísticos. */
export async function anonymizeClientAction(formData: FormData) {
  const user = await authorize("clients:delete");
  const id = String(formData.get("id"));
  if (formData.get("confirm") !== "ANONIMIZAR") throw new Error("Digite ANONIMIZAR para confirmar.");
  await mutate((db) => {
    const client = db.clients.find((c) => c.id === id && c.orgId === user.orgId);
    if (!client) throw new Error("Cliente não encontrado.");
    Object.assign(client, {
      name: "Titular anonimizado",
      phone: `000${client.id.replace(/\D/g, "").slice(0, 10)}`,
      email: "",
      city: "",
      notes: "",
      tags: ["Anonimizado"],
      consent: { status: "opt_out", source: "manual", at: now() },
      updatedAt: now(),
    });
    const convIds = new Set(db.conversations.filter((c) => c.clientId === id).map((c) => c.id));
    db.messages = db.messages.filter((m) => !convIds.has(m.conversationId));
    db.conversations = db.conversations.filter((c) => c.clientId !== id);
    db.tasks.forEach((t) => {
      if (t.clientId === id) t.clientId = null;
    });
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "lgpd.anonimizacao", entity: "cliente", entityId: id, details: "Dados pessoais e conversas removidos a pedido do titular.", ip: await clientIp() });
  revalidatePath("/clientes");
  redirect("/clientes");
}

export type ImportState = { analysis?: ImportAnalysis; csv?: string; error?: string; imported?: number } | undefined;

export async function analyzeImportAction(_: ImportState, formData: FormData): Promise<ImportState> {
  const user = await authorize("clients:import");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Selecione um arquivo CSV." };
  if (file.size > 2 * 1024 * 1024) return { error: "Arquivo muito grande (máx. 2 MB)." };
  const text = await file.text();
  const db = await getDb();
  const analysis = analyzeCsv(text, db.clients.filter((c) => c.orgId === user.orgId).map((c) => c.phone));
  return { analysis, csv: text };
}

export async function confirmImportAction(_: ImportState, formData: FormData): Promise<ImportState> {
  const user = await authorize("clients:import");
  const text = String(formData.get("csv") ?? "");
  if (!text || text.length > 2 * 1024 * 1024) return { error: "Dados de importação inválidos. Envie o arquivo novamente." };
  const consentConfirmed = formData.get("consentConfirmed") === "on";
  // Reanalisa no servidor: nunca confiar no resultado enviado pelo navegador.
  const db = await getDb();
  const analysis = analyzeCsv(text, db.clients.filter((c) => c.orgId === user.orgId).map((c) => c.phone));
  const t = now();
  await mutate((d) => {
    for (const r of analysis.valid) {
      const id = randomUUID();
      const client = {
        id,
        orgId: user.orgId,
        name: r.name,
        phone: r.phone,
        email: r.email,
        city: r.city,
        services: r.services,
        tags: ["Importado"],
        notes: r.notes,
        ownerId: null,
        consent: { status: "desconhecido" as const, source: null, at: null },
        createdAt: t,
        updatedAt: t,
        lastContactAt: null,
      };
      d.clients.unshift(client);
      d.deals.unshift({ id: randomUUID(), orgId: user.orgId, clientId: id, title: "Lead importado", valueCents: 0, stage: "novo_lead", ownerId: null, createdAt: t, updatedAt: t, closedAt: null });
      // Consentimento só é registrado se a coluna indicar E o usuário confirmar que há comprovação.
      if (r.consent && consentConfirmed) setConsent(d, client, "opt_in", "importacao", "Consentimento informado no arquivo importado.", user.id);
    }
  });
  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "cliente.importacao",
    entity: "cliente",
    entityId: null,
    details: `${analysis.valid.length} importados; ${analysis.duplicatesInFile.length} duplicados no arquivo; ${analysis.alreadyExists.length} já existentes; ${analysis.invalid.length} inválidos.`,
    ip: await clientIp(),
  });
  revalidatePath("/clientes");
  return { imported: analysis.valid.length, analysis };
}
