"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/session";
import { addFinanceEntry, confirmReceipt, reanalyzeReceipt, rejectReceipt, saveReceiptData } from "@/lib/business/service";
import type { PaymentMethod } from "@/lib/data/types";
import { parseMoneyToCents } from "@/lib/format";

export type FinState = { error?: string; ok?: number | string } | undefined;

const entrySchema = z.object({
  kind: z.enum(["entrada", "saida"]),
  category: z.string().trim().min(1, "Informe a categoria.").max(60),
  description: z.string().trim().min(2, "Descreva o lançamento.").max(200),
  amount: z.string().min(1, "Informe o valor."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data."),
});

export async function addEntryAction(_: FinState, formData: FormData): Promise<FinState> {
  const user = await authorize("finance:manage");
  const parsed = entrySchema.safeParse(Object.fromEntries(["kind", "category", "description", "amount", "date"].map((k) => [k, String(formData.get(k) ?? "")])));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const amountCents = parseMoneyToCents(parsed.data.amount);
  if (!amountCents) return { error: "Valor inválido." };
  const r = await addFinanceEntry(user, { ...parsed.data, amountCents });
  if (!r.ok) return { error: r.error };
  revalidatePath("/financeiro");
  return { ok: Date.now() };
}

const METHODS = ["pix", "boleto", "ted", "cartao", "dinheiro", "outro"];
const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max) || null;

export async function saveReceiptAction(_: FinState, formData: FormData): Promise<FinState> {
  const user = await authorize("finance:manage");
  const id = String(formData.get("id"));
  const valor = String(formData.get("valor") ?? "");
  const valorCentavos = valor.trim() ? parseMoneyToCents(valor) : null;
  if (valor.trim() && !valorCentavos) return { error: "Valor inválido." };
  const date = String(formData.get("dataPagamento") ?? "");
  const metodo = String(formData.get("metodo") ?? "");
  const r = await saveReceiptData(user, id, {
    valorCentavos,
    dataPagamento: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    pagador: text(formData.get("pagador"), 160),
    recebedor: text(formData.get("recebedor"), 160),
    banco: text(formData.get("banco"), 80),
    metodo: METHODS.includes(metodo) ? (metodo as PaymentMethod) : null,
    idTransacao: text(formData.get("idTransacao"), 120),
    confianca: 1,
    observacao: String(formData.get("observacao") ?? "").slice(0, 300),
  });
  if (!r.ok) return { error: r.error };
  revalidatePath(`/financeiro/comprovantes/${id}`);
  revalidatePath("/financeiro");
  return { ok: r.value.status === "duplicado" ? "Dados salvos — atenção: parece repetido de outro comprovante." : "Dados salvos." };
}

export async function confirmReceiptAction(_: FinState, formData: FormData): Promise<FinState> {
  const user = await authorize("finance:manage");
  const id = String(formData.get("id"));
  const saleId = String(formData.get("saleId") ?? "");
  if (!saleId) return { error: "Escolha a venda paga por este comprovante." };
  const r = await confirmReceipt(user, id, saleId, formData.get("acceptDifference") === "on");
  if (!r.ok) return { error: r.error };
  for (const p of ["/financeiro", `/financeiro/comprovantes/${id}`, "/vendas", "/producao"]) revalidatePath(p);
  return { ok: `Pagamento confirmado. Venda nº ${r.value.sale.number} paga${r.value.order ? ` e ordem de produção nº ${r.value.order.number} criada` : ""}.` };
}

export async function rejectReceiptAction(_: FinState, formData: FormData): Promise<FinState> {
  const user = await authorize("finance:manage");
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "Informe o motivo." };
  const r = await rejectReceipt(user, id, reason);
  if (!r.ok) return { error: r.error };
  revalidatePath(`/financeiro/comprovantes/${id}`);
  revalidatePath("/financeiro");
  return { ok: Date.now() };
}

export async function reanalyzeReceiptAction(_: FinState, formData: FormData): Promise<FinState> {
  const user = await authorize("finance:manage");
  const id = String(formData.get("id"));
  const r = await reanalyzeReceipt(user, id);
  if (!r.ok) return { error: r.error };
  revalidatePath(`/financeiro/comprovantes/${id}`);
  return r.value.analysisError ? { error: r.value.analysisError } : { ok: "Comprovante lido novamente." };
}
