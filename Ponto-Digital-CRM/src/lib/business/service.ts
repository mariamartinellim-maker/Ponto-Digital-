import "server-only";
import { randomUUID } from "node:crypto";
import { analyzeReceipt } from "../ai/receipt";
import type { SessionUser } from "../auth/session";
import { getOne, insertOne, listAll, nextNumber, updateOne } from "../data/collections";
import { audit } from "../data/repo";
import { getDb } from "../data/store";
import type { FinanceEntry, MediaAsset, PaymentMethod, ProductionOrder, ProductionStage, Receipt, ReceiptData, Sale, SaleItem } from "../data/types";
import { getFile, saveAsset } from "../media/storage";
import { isSupabase, supabaseServer } from "../supabase/server";
import { canMoveProduction, canTransitionSale, findDuplicate, productionFromSale, saleTotal, validateItems } from "./rules";

/*
 * Fluxo operacional: venda → comprovante → confirmação financeira → ordem de produção.
 * Toda confirmação de pagamento é feita por uma pessoa (a IA só lê o comprovante).
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const nowIso = () => new Date().toISOString();
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // dia em Brasília

/** Cliente da organização (nome), nos dois modos. */
export async function findClient(orgId: string, id: string): Promise<{ id: string; name: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (isSupabase()) {
    const { data } = await (await supabaseServer()).from("clients").select("id,name").eq("org_id", orgId).eq("id", id).maybeSingle();
    return data ? { id: String(data.id), name: String(data.name) } : null;
  }
  const c = (await getDb()).clients.find((x) => x.orgId === orgId && x.id === id);
  return c ? { id: c.id, name: c.name } : null;
}

export async function clientNames(orgId: string): Promise<Map<string, string>> {
  if (isSupabase()) {
    const { data } = await (await supabaseServer()).from("clients").select("id,name").eq("org_id", orgId).limit(10000);
    return new Map((data ?? []).map((c) => [String(c.id), String(c.name)]));
  }
  return new Map((await getDb()).clients.filter((c) => c.orgId === orgId).map((c) => [c.id, c.name]));
}

// ---------------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------------
export async function createSale(
  user: SessionUser,
  input: { clientId: string; items: SaleItem[]; paymentMethod: PaymentMethod; dueDate: string | null; notes: string; dealId?: string | null; conversationId?: string | null },
): Promise<Result<Sale>> {
  const client = await findClient(user.orgId, input.clientId);
  if (!client) return fail("Cliente não encontrado.");
  const err = validateItems(input.items);
  if (err) return fail(err);
  const sale: Sale = {
    id: randomUUID(),
    orgId: user.orgId,
    number: await nextNumber(user.orgId, "sales"),
    clientId: client.id,
    dealId: input.dealId ?? null,
    conversationId: input.conversationId ?? null,
    items: input.items.map((i) => ({ description: i.description.trim(), quantity: i.quantity, unitCents: i.unitCents })),
    totalCents: saleTotal(input.items),
    status: "aguardando_pagamento",
    paymentMethod: input.paymentMethod,
    dueDate: input.dueDate,
    paidAt: null,
    receiptId: null,
    notes: input.notes.slice(0, 2000),
    createdBy: user.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  try {
    const saved = await insertOne("sales", sale);
    await audit({ orgId: user.orgId, userId: user.id, action: "venda.criada", entity: "venda", entityId: saved.id, details: `nº ${saved.number} · ${client.name}` });
    return { ok: true, value: saved };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function cancelSale(user: SessionUser, saleId: string, reason: string): Promise<Result<Sale>> {
  const sale = await getOne(user.orgId, "sales", saleId);
  if (!sale) return fail("Venda não encontrada.");
  if (!canTransitionSale(sale.status, "cancelada")) return fail("Esta venda não pode ser cancelada.");
  if (sale.status === "pago" && user.role === "atendente") return fail("Somente gestores cancelam vendas já pagas.");
  const updated = await updateOne(user.orgId, "sales", saleId, { status: "cancelada", notes: `${sale.notes}\n[Cancelada] ${reason}`.trim().slice(0, 2000), updatedAt: nowIso() });
  // Venda paga cancelada: estorno no financeiro e produção cancelada (sem apagar o histórico).
  if (sale.status === "pago") {
    await insertOne("financeEntries", {
      id: randomUUID(), orgId: user.orgId, kind: "saida", category: "Estornos", description: `Estorno da venda nº ${sale.number}`, amountCents: sale.totalCents,
      date: today(), saleId: sale.id, receiptId: sale.receiptId, createdBy: user.id, createdAt: nowIso(),
    });
    for (const o of await listAll(user.orgId, "productionOrders", { where: { saleId: sale.id } })) {
      if (o.stage !== "entregue" && o.stage !== "cancelada") await updateOne(user.orgId, "productionOrders", o.id, { stage: "cancelada", updatedAt: nowIso() });
    }
  }
  await audit({ orgId: user.orgId, userId: user.id, action: "venda.cancelada", entity: "venda", entityId: saleId, details: reason.slice(0, 300) });
  return updated ? { ok: true, value: updated } : fail("Venda não encontrada.");
}

/**
 * Pagamento confirmado: venda paga, entrada no financeiro e ordem de produção criada (uma por venda).
 * Chamado pela confirmação do comprovante ou pela baixa manual de um gestor.
 */
export async function markSalePaid(user: SessionUser, saleId: string, opts: { receiptId?: string | null; paidAt?: string } = {}): Promise<Result<{ sale: Sale; order: ProductionOrder | null; entry: FinanceEntry }>> {
  const sale = await getOne(user.orgId, "sales", saleId);
  if (!sale) return fail("Venda não encontrada.");
  if (sale.status !== "aguardando_pagamento") return fail(sale.status === "pago" ? "Esta venda já está paga." : "Venda cancelada.");
  const client = await findClient(user.orgId, sale.clientId);
  const paidAt = opts.paidAt ?? nowIso();
  const updated = (await updateOne(user.orgId, "sales", saleId, { status: "pago", paidAt, receiptId: opts.receiptId ?? null, updatedAt: nowIso() }))!;
  const entry = await insertOne("financeEntries", {
    id: randomUUID(),
    orgId: user.orgId,
    kind: "entrada",
    category: "Vendas",
    description: `Venda nº ${sale.number} — ${client?.name ?? "cliente"}`.slice(0, 200),
    amountCents: sale.totalCents,
    date: paidAt.slice(0, 10),
    saleId: sale.id,
    receiptId: opts.receiptId ?? null,
    createdBy: user.id,
    createdAt: nowIso(),
  });
  let order: ProductionOrder | null = null;
  const existing = await listAll(user.orgId, "productionOrders", { where: { saleId: sale.id } });
  if (!existing.length) {
    const base = productionFromSale(updated, client?.name ?? "cliente");
    order = await insertOne("productionOrders", {
      id: randomUUID(),
      orgId: user.orgId,
      number: await nextNumber(user.orgId, "productionOrders"),
      ...base,
      stage: "fila",
      assigneeId: null,
      dueDate: sale.dueDate,
      notes: sale.notes,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deliveredAt: null,
    });
  }
  await audit({ orgId: user.orgId, userId: user.id, action: "venda.paga", entity: "venda", entityId: saleId, details: `nº ${sale.number}${opts.receiptId ? " · comprovante" : " · baixa manual"}${order ? ` · produção nº ${order.number}` : ""}` });
  return { ok: true, value: { sale: updated, order, entry } };
}

// ---------------------------------------------------------------------------
// Comprovantes
// ---------------------------------------------------------------------------
async function analyzeInto(user: SessionUser, receipt: Receipt, asset: MediaAsset): Promise<Receipt> {
  const bytes = await getFile(asset.storageKey);
  if (!bytes) return (await updateOne(user.orgId, "receipts", receipt.id, { analysisError: "Arquivo não encontrado." }))!;
  const r = await analyzeReceipt(bytes, asset.mime);
  if (!r.ok) return (await updateOne(user.orgId, "receipts", receipt.id, { analysisError: r.error }))!;
  const others = (await listAll(user.orgId, "receipts")).filter((x) => x.id !== receipt.id);
  const dup = findDuplicate(r.data, others);
  return (await updateOne(user.orgId, "receipts", receipt.id, {
    data: r.data,
    analyzer: "ia",
    analysisError: r.isReceipt ? null : "A IA indica que este arquivo não parece um comprovante de pagamento.",
    status: dup ? "duplicado" : "pendente",
    duplicateOf: dup?.id ?? null,
  }))!;
}

/** Registra um comprovante a partir de um arquivo da biblioteca (enviado agora ou recebido pelo WhatsApp). */
export async function receiptFromAsset(user: SessionUser, assetId: string, clientId: string | null): Promise<Result<Receipt>> {
  const asset = await getOne(user.orgId, "mediaAssets", assetId);
  if (!asset) return fail("Arquivo não encontrado.");
  if (asset.type !== "image" && asset.type !== "document") return fail("Comprovantes precisam ser imagem (JPG, PNG, WEBP) ou PDF.");
  const existing = await listAll(user.orgId, "receipts", { where: { mediaId: asset.id } });
  if (existing.length) return fail("Este arquivo já foi registrado como comprovante.");
  const receipt = await insertOne("receipts", {
    id: randomUUID(),
    orgId: user.orgId,
    mediaId: asset.id,
    clientId: clientId ?? asset.clientId,
    saleId: null,
    status: "pendente",
    data: null,
    analyzer: "pendente",
    analysisError: null,
    duplicateOf: null,
    reviewedBy: null,
    reviewedAt: null,
    createdBy: user.id,
    createdAt: nowIso(),
  });
  const analyzed = await analyzeInto(user, receipt, asset);
  await audit({ orgId: user.orgId, userId: user.id, action: "comprovante.recebido", entity: "comprovante", entityId: receipt.id, details: analyzed.analyzer === "ia" ? "lido pela IA" : "aguardando digitação" });
  return { ok: true, value: analyzed };
}

export async function uploadReceipt(user: SessionUser, file: { bytes: Uint8Array; mime: string; filename: string }, clientId: string | null): Promise<Result<Receipt>> {
  if (clientId && !(await findClient(user.orgId, clientId))) return fail("Cliente não encontrado.");
  const asset = await saveAsset({ orgId: user.orgId, ...file, title: `Comprovante ${file.filename}`, tags: ["comprovante"], source: "upload", clientId, createdBy: user.id });
  if ("error" in asset) return fail(asset.error);
  return receiptFromAsset(user, asset.id, clientId);
}

export async function reanalyzeReceipt(user: SessionUser, receiptId: string): Promise<Result<Receipt>> {
  const receipt = await getOne(user.orgId, "receipts", receiptId);
  if (!receipt || receipt.status === "confirmado") return fail("Comprovante não encontrado ou já confirmado.");
  const asset = await getOne(user.orgId, "mediaAssets", receipt.mediaId);
  if (!asset) return fail("Arquivo não encontrado.");
  return { ok: true, value: await analyzeInto(user, receipt, asset) };
}

/** Correção manual dos dados lidos (ou digitação, quando a IA está desligada). */
export async function saveReceiptData(user: SessionUser, receiptId: string, data: ReceiptData): Promise<Result<Receipt>> {
  const receipt = await getOne(user.orgId, "receipts", receiptId);
  if (!receipt) return fail("Comprovante não encontrado.");
  if (receipt.status === "confirmado" || receipt.status === "rejeitado") return fail("Comprovante já revisado.");
  const others = (await listAll(user.orgId, "receipts")).filter((x) => x.id !== receipt.id);
  const dup = findDuplicate(data, others);
  const updated = await updateOne(user.orgId, "receipts", receiptId, {
    data: { ...data, confianca: 1 },
    analyzer: receipt.analyzer === "ia" ? "ia" : "manual",
    status: dup ? "duplicado" : "pendente",
    duplicateOf: dup?.id ?? null,
  });
  return updated ? { ok: true, value: updated } : fail("Comprovante não encontrado.");
}

/** Confirmação humana: vincula o comprovante à venda e dá baixa no pagamento. */
export async function confirmReceipt(user: SessionUser, receiptId: string, saleId: string, acceptDifference = false): Promise<Result<{ sale: Sale; order: ProductionOrder | null }>> {
  const receipt = await getOne(user.orgId, "receipts", receiptId);
  if (!receipt) return fail("Comprovante não encontrado.");
  if (receipt.status === "duplicado") return fail("Comprovante repetido: já existe outro com os mesmos dados. Confira antes de confirmar.");
  if (receipt.status !== "pendente") return fail("Comprovante já revisado.");
  if (!receipt.data?.valorCentavos) return fail("Informe o valor do comprovante antes de confirmar.");
  const sale = await getOne(user.orgId, "sales", saleId);
  if (!sale || sale.status !== "aguardando_pagamento") return fail("Venda não encontrada ou não está aguardando pagamento.");
  if (receipt.data.valorCentavos !== sale.totalCents && !acceptDifference) {
    return fail("O valor do comprovante é diferente do total da venda. Marque “aceitar diferença” se estiver correto.");
  }
  const dup = findDuplicate(receipt.data, (await listAll(user.orgId, "receipts")).filter((x) => x.id !== receipt.id && x.status === "confirmado"));
  if (dup) return fail("Já existe um comprovante confirmado com os mesmos dados.");
  const paid = await markSalePaid(user, sale.id, { receiptId: receipt.id, paidAt: receipt.data.dataPagamento ? `${receipt.data.dataPagamento}T12:00:00.000Z` : undefined });
  if (!paid.ok) return paid;
  await updateOne(user.orgId, "receipts", receipt.id, { status: "confirmado", saleId: sale.id, clientId: receipt.clientId ?? sale.clientId, reviewedBy: user.id, reviewedAt: nowIso() });
  await audit({ orgId: user.orgId, userId: user.id, action: "comprovante.confirmado", entity: "comprovante", entityId: receipt.id, details: `venda nº ${sale.number}` });
  return { ok: true, value: { sale: paid.value.sale, order: paid.value.order } };
}

export async function rejectReceipt(user: SessionUser, receiptId: string, reason: string): Promise<Result<Receipt>> {
  const receipt = await getOne(user.orgId, "receipts", receiptId);
  if (!receipt || receipt.status === "confirmado" || receipt.status === "rejeitado") return fail("Comprovante não encontrado ou já revisado.");
  const updated = await updateOne(user.orgId, "receipts", receiptId, { status: "rejeitado", analysisError: reason.slice(0, 300) || receipt.analysisError, reviewedBy: user.id, reviewedAt: nowIso() });
  await audit({ orgId: user.orgId, userId: user.id, action: "comprovante.rejeitado", entity: "comprovante", entityId: receiptId, details: reason.slice(0, 300) });
  return updated ? { ok: true, value: updated } : fail("Comprovante não encontrado.");
}

// ---------------------------------------------------------------------------
// Financeiro (lançamentos manuais)
// ---------------------------------------------------------------------------
export async function addFinanceEntry(user: SessionUser, input: Pick<FinanceEntry, "kind" | "category" | "description" | "amountCents" | "date">): Promise<Result<FinanceEntry>> {
  if (!input.description.trim()) return fail("Descreva o lançamento.");
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 10_000_000_000) return fail("Valor inválido.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return fail("Data inválida.");
  const entry = await insertOne("financeEntries", {
    id: randomUUID(), orgId: user.orgId, ...input, category: input.category.trim().slice(0, 60) || "Outros", description: input.description.trim().slice(0, 200),
    saleId: null, receiptId: null, createdBy: user.id, createdAt: nowIso(),
  });
  await audit({ orgId: user.orgId, userId: user.id, action: `financeiro.${input.kind}`, entity: "financeiro", entityId: entry.id, details: entry.description });
  return { ok: true, value: entry };
}

// ---------------------------------------------------------------------------
// Produção
// ---------------------------------------------------------------------------
export async function createProductionOrder(user: SessionUser, input: { clientId: string; title: string; checklist: string[]; dueDate: string | null; assigneeId: string | null }): Promise<Result<ProductionOrder>> {
  const client = await findClient(user.orgId, input.clientId);
  if (!client) return fail("Cliente não encontrado.");
  if (!input.title.trim()) return fail("Dê um título à ordem.");
  const order = await insertOne("productionOrders", {
    id: randomUUID(), orgId: user.orgId, number: await nextNumber(user.orgId, "productionOrders"), saleId: null, clientId: client.id, title: input.title.trim().slice(0, 200),
    checklist: input.checklist.map((d) => d.trim()).filter(Boolean).slice(0, 50).map((description) => ({ description: description.slice(0, 200), done: false })),
    stage: "fila", assigneeId: input.assigneeId, dueDate: input.dueDate, notes: "", createdAt: nowIso(), updatedAt: nowIso(), deliveredAt: null,
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "producao.criada", entity: "producao", entityId: order.id, details: `nº ${order.number}` });
  return { ok: true, value: order };
}

export async function moveProduction(user: SessionUser, orderId: string, to: ProductionStage): Promise<Result<ProductionOrder>> {
  const order = await getOne(user.orgId, "productionOrders", orderId);
  if (!order) return fail("Ordem não encontrada.");
  if (!canMoveProduction(order.stage, to)) return fail("Mudança de etapa não permitida.");
  if (to === "entregue" && order.checklist.some((c) => !c.done)) return fail("Conclua todos os itens do checklist antes de entregar.");
  if (to === "cancelada" && user.role === "atendente") return fail("Somente gestores cancelam ordens de produção.");
  const updated = await updateOne(user.orgId, "productionOrders", orderId, { stage: to, updatedAt: nowIso(), deliveredAt: to === "entregue" ? nowIso() : null });
  await audit({ orgId: user.orgId, userId: user.id, action: "producao.etapa", entity: "producao", entityId: orderId, details: `${order.stage} → ${to}` });
  return updated ? { ok: true, value: updated } : fail("Ordem não encontrada.");
}

export async function toggleChecklist(user: SessionUser, orderId: string, index: number): Promise<Result<ProductionOrder>> {
  const order = await getOne(user.orgId, "productionOrders", orderId);
  if (!order || !order.checklist[index]) return fail("Item não encontrado.");
  if (order.stage === "entregue" || order.stage === "cancelada") return fail("Ordem encerrada.");
  const checklist = order.checklist.map((c, i) => (i === index ? { ...c, done: !c.done } : c));
  const updated = await updateOne(user.orgId, "productionOrders", orderId, { checklist, updatedAt: nowIso() });
  return updated ? { ok: true, value: updated } : fail("Ordem não encontrada.");
}

export async function assignProduction(user: SessionUser, orderId: string, assigneeId: string | null): Promise<Result<ProductionOrder>> {
  const updated = await updateOne(user.orgId, "productionOrders", orderId, { assigneeId, updatedAt: nowIso() });
  return updated ? { ok: true, value: updated } : fail("Ordem não encontrada.");
}
