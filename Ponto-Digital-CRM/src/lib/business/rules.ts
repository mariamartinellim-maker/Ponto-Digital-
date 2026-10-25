import type { FinanceEntry, ProductionOrder, ProductionStage, Receipt, ReceiptData, Sale, SaleItem } from "../data/types";

/* Regras de negócio puras (vendas, comprovantes, financeiro e produção): sem banco, testáveis isoladamente. */

export const SALE_STATUS_LABEL: Record<Sale["status"], string> = {
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pago",
  cancelada: "Cancelada",
};

export const PAYMENT_LABEL: Record<Sale["paymentMethod"], string> = {
  pix: "Pix",
  boleto: "Boleto",
  ted: "TED / transferência",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
  outro: "Outro",
};

export const RECEIPT_STATUS: Record<Receipt["status"], { label: string; tone: "amber" | "red" | "green" | "slate" }> = {
  pendente: { label: "Aguardando conferência", tone: "amber" },
  duplicado: { label: "Possível duplicado", tone: "red" },
  confirmado: { label: "Confirmado", tone: "green" },
  rejeitado: { label: "Rejeitado", tone: "slate" },
};

export const PRODUCTION_STAGES: { id: ProductionStage; label: string }[] = [
  { id: "fila", label: "Na fila" },
  { id: "producao", label: "Em produção" },
  { id: "revisao", label: "Revisão / aprovação" },
  { id: "entregue", label: "Entregue" },
  { id: "cancelada", label: "Cancelada" },
];
export const STAGE_LABEL = Object.fromEntries(PRODUCTION_STAGES.map((s) => [s.id, s.label])) as Record<ProductionStage, string>;

/** Itens válidos: descrição, quantidade inteira de 1 a 10.000, valor unitário até R$ 10 milhões. */
export function validateItems(items: SaleItem[]): string | null {
  if (!items.length) return "Inclua ao menos um item.";
  if (items.length > 50) return "No máximo 50 itens por venda.";
  for (const it of items) {
    if (!it.description.trim() || it.description.length > 200) return "Cada item precisa de uma descrição (até 200 caracteres).";
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 10000) return "Quantidade inválida.";
    if (!Number.isInteger(it.unitCents) || it.unitCents < 1 || it.unitCents > 1_000_000_000) return "Valor unitário inválido.";
  }
  return null;
}

export const saleTotal = (items: SaleItem[]) => items.reduce((s, it) => s + it.quantity * it.unitCents, 0);

/** Transições permitidas da venda. Venda paga não volta a "aguardando"; cancelada é final. */
export function canTransitionSale(from: Sale["status"], to: Sale["status"]) {
  if (from === to) return false;
  if (from === "cancelada") return false;
  if (from === "pago") return to === "cancelada";
  return true;
}

/** Transições da produção: segue em frente, volta uma etapa (correção) ou cancela; entregue/cancelada são finais. */
export function canMoveProduction(from: ProductionStage, to: ProductionStage) {
  if (from === to || from === "entregue" || from === "cancelada") return false;
  if (to === "cancelada") return true;
  const order: ProductionStage[] = ["fila", "producao", "revisao", "entregue"];
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  return b === a + 1 || b === a - 1;
}

/** Ordem de produção a partir da venda paga: um item do checklist por item vendido. */
export function productionFromSale(sale: Sale, clientName: string): Pick<ProductionOrder, "title" | "checklist" | "clientId" | "saleId"> {
  return {
    title: `Venda nº ${sale.number} — ${clientName}`.slice(0, 200),
    clientId: sale.clientId,
    saleId: sale.id,
    checklist: sale.items.map((it) => ({ description: it.quantity > 1 ? `${it.description} (x${it.quantity})` : it.description, done: false })),
  };
}

const normId = (s: string | null | undefined) => (s ?? "").replace(/[\s.\-/]/g, "").toUpperCase();

/**
 * Comprovante repetido: mesmo ID de transação, ou mesmo valor + data + pagador de um comprovante já
 * confirmado ou pendente. Evita confirmar o mesmo pagamento duas vezes.
 */
export function findDuplicate(data: ReceiptData, others: Receipt[]): Receipt | null {
  const live = others.filter((r) => r.data && (r.status === "confirmado" || r.status === "pendente"));
  const id = normId(data.idTransacao);
  if (id.length >= 6) {
    const hit = live.find((r) => normId(r.data!.idTransacao) === id);
    if (hit) return hit;
  }
  if (data.valorCentavos && data.dataPagamento && data.pagador) {
    const payer = data.pagador.trim().toLowerCase();
    return (
      live.find(
        (r) => r.data!.valorCentavos === data.valorCentavos && r.data!.dataPagamento === data.dataPagamento && (r.data!.pagador ?? "").trim().toLowerCase() === payer,
      ) ?? null
    );
  }
  return null;
}

export interface SaleMatch {
  sale: Sale;
  score: number;
  reasons: string[];
}

/** Vendas em aberto compatíveis com o comprovante, da mais provável para a menos provável. */
export function matchSales(data: ReceiptData | null, sales: Sale[], clientId: string | null): SaleMatch[] {
  const open = sales.filter((s) => s.status === "aguardando_pagamento");
  const out: SaleMatch[] = [];
  for (const sale of open) {
    let score = 0;
    const reasons: string[] = [];
    if (data?.valorCentavos != null) {
      if (data.valorCentavos === sale.totalCents) {
        score += 60;
        reasons.push("valor exato");
      } else if (Math.abs(data.valorCentavos - sale.totalCents) <= 100) {
        score += 30;
        reasons.push("valor próximo");
      } else continue; // valor diferente: não é esta venda
    }
    if (clientId && sale.clientId === clientId) {
      score += 30;
      reasons.push("mesmo cliente");
    }
    if (data?.metodo && data.metodo === sale.paymentMethod) {
      score += 5;
      reasons.push("mesma forma de pagamento");
    }
    if (data?.dataPagamento && data.dataPagamento >= sale.createdAt.slice(0, 10)) score += 5;
    out.push({ sale, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** O comprovante precisa de revisão manual reforçada (baixa confiança ou dados essenciais faltando). */
export function needsAttention(data: ReceiptData | null): string[] {
  if (!data) return ["Comprovante ainda não analisado."];
  const w: string[] = [];
  if (data.valorCentavos == null) w.push("Valor não identificado.");
  if (!data.dataPagamento) w.push("Data não identificada.");
  if (data.confianca < 0.7) w.push("Leitura com baixa confiança: confira a imagem.");
  return w;
}

export interface FinanceSummary {
  inMonth: number;
  outMonth: number;
  balanceMonth: number;
  receivable: number;
  receivableCount: number;
  salesMonth: number;
  salesMonthCount: number;
}

/** Resumo do mês (AAAA-MM) e do que está a receber. */
export function financeSummary(entries: FinanceEntry[], sales: Sale[], month: string): FinanceSummary {
  const inMonth = entries.filter((e) => e.kind === "entrada" && e.date.startsWith(month)).reduce((s, e) => s + e.amountCents, 0);
  const outMonth = entries.filter((e) => e.kind === "saida" && e.date.startsWith(month)).reduce((s, e) => s + e.amountCents, 0);
  const open = sales.filter((s) => s.status === "aguardando_pagamento");
  const monthSales = sales.filter((s) => s.status !== "cancelada" && s.createdAt.startsWith(month));
  return {
    inMonth,
    outMonth,
    balanceMonth: inMonth - outMonth,
    receivable: open.reduce((s, x) => s + x.totalCents, 0),
    receivableCount: open.length,
    salesMonth: monthSales.reduce((s, x) => s + x.totalCents, 0),
    salesMonthCount: monthSales.length,
  };
}
