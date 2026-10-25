"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/session";
import { cancelSale, createSale, markSalePaid } from "@/lib/business/service";
import { parseMoneyToCents } from "@/lib/format";

export type SaleState = { error?: string; ok?: number | string } | undefined;

const schema = z.object({
  clientId: z.string().min(1, "Escolha o cliente.").max(64),
  paymentMethod: z.enum(["pix", "boleto", "ted", "cartao", "dinheiro", "outro"]),
  dueDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  notes: z.string().max(2000),
  conversationId: z.string().max(64),
});

export async function createSaleAction(_: SaleState, formData: FormData): Promise<SaleState> {
  const user = await authorize("sales:manage");
  const parsed = schema.safeParse({
    clientId: formData.get("clientId") ?? "",
    paymentMethod: formData.get("paymentMethod") ?? "pix",
    dueDate: formData.get("dueDate") ?? "",
    notes: formData.get("notes") ?? "",
    conversationId: formData.get("conversationId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const descriptions = formData.getAll("itemDescription").map(String);
  const quantities = formData.getAll("itemQuantity").map(String);
  const prices = formData.getAll("itemPrice").map(String);
  const items = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = descriptions[i]!.trim();
    if (!description && !prices[i]?.trim()) continue;
    const unitCents = parseMoneyToCents(prices[i] ?? "");
    if (unitCents === null || unitCents === 0) return { error: `Informe o valor do item “${description || i + 1}”.` };
    items.push({ description, quantity: Number(quantities[i] || 1), unitCents });
  }
  const v = parsed.data;
  const r = await createSale(user, {
    clientId: v.clientId,
    items,
    paymentMethod: v.paymentMethod,
    dueDate: v.dueDate || null,
    notes: v.notes,
    conversationId: /^[0-9a-f-]{36}$/.test(v.conversationId) ? v.conversationId : null,
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/vendas");
  return { ok: `Venda nº ${r.value.number} registrada. Aguardando pagamento.` };
}

export async function cancelSaleAction(_: SaleState, formData: FormData): Promise<SaleState> {
  const user = await authorize("sales:manage");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "Informe o motivo do cancelamento." };
  const r = await cancelSale(user, String(formData.get("id")), reason);
  if (!r.ok) return { error: r.error };
  revalidatePath("/vendas");
  revalidatePath("/financeiro");
  revalidatePath("/producao");
  return { ok: Date.now() };
}

/** Baixa manual (sem comprovante digital): somente o Financeiro. */
export async function markPaidAction(_: SaleState, formData: FormData): Promise<SaleState> {
  const user = await authorize("finance:manage");
  const r = await markSalePaid(user, String(formData.get("id")));
  if (!r.ok) return { error: r.error };
  revalidatePath("/vendas");
  revalidatePath("/financeiro");
  revalidatePath("/producao");
  return { ok: r.value.order ? `Pagamento registrado. Ordem de produção nº ${r.value.order.number} criada.` : "Pagamento registrado." };
}
