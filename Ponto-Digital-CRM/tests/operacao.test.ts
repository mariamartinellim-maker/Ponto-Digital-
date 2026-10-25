import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import {
  canMoveProduction,
  canTransitionSale,
  financeSummary,
  findDuplicate,
  matchSales,
  needsAttention,
  productionFromSale,
  saleTotal,
  validateItems,
} from "@/lib/business/rules";
import { cancelSale, confirmReceipt, createSale, markSalePaid, moveProduction, rejectReceipt, saveReceiptData, toggleChecklist, uploadReceipt } from "@/lib/business/service";
import { parseBrlToCents } from "@/lib/ai/receipt";
import { listAll } from "@/lib/data/collections";
import { publicUser } from "@/lib/data/repo";
import { getDb } from "@/lib/data/store";
import type { Receipt, ReceiptData, Sale } from "@/lib/data/types";
import { classifyUpload, sniffMatches } from "@/lib/media/storage";
import { validateBackup } from "@/lib/guardian/guardian";
import { can } from "@/lib/permissions";

const sale = (p: Partial<Sale>): Sale => ({
  id: "s1", orgId: "o", number: 1, clientId: "c1", dealId: null, conversationId: null, items: [{ description: "Logo", quantity: 1, unitCents: 150000 }],
  totalCents: 150000, status: "aguardando_pagamento", paymentMethod: "pix", dueDate: null, paidAt: null, receiptId: null, notes: "", createdBy: null,
  createdAt: "2026-10-20T12:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z", ...p,
});
const data = (p: Partial<ReceiptData>): ReceiptData => ({ valorCentavos: 150000, dataPagamento: "2026-10-25", pagador: "Maria", recebedor: null, banco: null, metodo: "pix", idTransacao: null, confianca: 0.9, observacao: "", ...p });
const receipt = (p: Partial<Receipt>): Receipt => ({ id: "r1", orgId: "o", mediaId: "m", clientId: null, saleId: null, status: "confirmado", data: data({}), analyzer: "ia", analysisError: null, duplicateOf: null, reviewedBy: null, reviewedAt: null, createdBy: null, createdAt: "", ...p });

// PNG mínimo válido (1×1)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("regras de vendas, comprovantes, financeiro e produção", () => {
  it("valida itens e calcula o total", () => {
    expect(validateItems([])).toMatch(/ao menos um item/);
    expect(validateItems([{ description: "Site", quantity: 0, unitCents: 100 }])).toMatch(/Quantidade/);
    expect(validateItems([{ description: "Site", quantity: 2, unitCents: 250000 }])).toBeNull();
    expect(saleTotal([{ description: "a", quantity: 2, unitCents: 1000 }, { description: "b", quantity: 1, unitCents: 500 }])).toBe(2500);
  });

  it("controla as transições da venda e da produção", () => {
    expect(canTransitionSale("aguardando_pagamento", "pago")).toBe(true);
    expect(canTransitionSale("pago", "aguardando_pagamento")).toBe(false);
    expect(canTransitionSale("cancelada", "pago")).toBe(false);
    expect(canMoveProduction("fila", "producao")).toBe(true);
    expect(canMoveProduction("fila", "entregue")).toBe(false); // não pula etapas
    expect(canMoveProduction("revisao", "producao")).toBe(true); // volta para correção
    expect(canMoveProduction("entregue", "producao")).toBe(false);
  });

  it("gera a ordem de produção com um item de checklist por item vendido", () => {
    const o = productionFromSale(sale({ items: [{ description: "Logo", quantity: 1, unitCents: 1 }, { description: "Cartão", quantity: 500, unitCents: 1 }] }), "Ana");
    expect(o.title).toBe("Venda nº 1 — Ana");
    expect(o.checklist.map((c) => c.description)).toEqual(["Logo", "Cartão (x500)"]);
  });

  it("detecta comprovantes repetidos", () => {
    expect(findDuplicate(data({ idTransacao: "E123456789" }), [receipt({ data: data({ idTransacao: "e 123.456.789" }) })])).not.toBeNull();
    expect(findDuplicate(data({}), [receipt({})])).not.toBeNull(); // mesmo valor + data + pagador
    expect(findDuplicate(data({}), [receipt({ status: "rejeitado" })])).toBeNull();
    expect(findDuplicate(data({ pagador: "João" }), [receipt({})])).toBeNull();
  });

  it("sugere a venda compatível com o comprovante", () => {
    const sales = [sale({ id: "a", totalCents: 150000, clientId: "c1" }), sale({ id: "b", totalCents: 150000, clientId: "c2" }), sale({ id: "c", totalCents: 99000 })];
    const m = matchSales(data({}), sales, "c2");
    expect(m.map((x) => x.sale.id)).toEqual(["b", "a"]);
    expect(m[0]!.reasons).toContain("mesmo cliente");
    expect(needsAttention(data({ confianca: 0.4, valorCentavos: null }))).toHaveLength(2);
  });

  it("lê valores em reais", () => {
    expect(parseBrlToCents("R$ 1.250,00")).toBe(125000);
    expect(parseBrlToCents("1250.5")).toBe(125050);
    expect(parseBrlToCents("ilegível")).toBeNull();
  });

  it("resume o mês e o que está a receber", () => {
    const s = financeSummary(
      [
        { id: "1", orgId: "o", kind: "entrada", category: "Vendas", description: "", amountCents: 1000, date: "2026-10-02", saleId: null, receiptId: null, createdBy: null, createdAt: "" },
        { id: "2", orgId: "o", kind: "saida", category: "X", description: "", amountCents: 300, date: "2026-10-05", saleId: null, receiptId: null, createdBy: null, createdAt: "" },
        { id: "3", orgId: "o", kind: "entrada", category: "Vendas", description: "", amountCents: 9999, date: "2026-09-30", saleId: null, receiptId: null, createdBy: null, createdAt: "" },
      ],
      [sale({ totalCents: 5000, createdAt: "2026-10-10T00:00:00Z" })],
      "2026-10",
    );
    expect(s).toMatchObject({ inMonth: 1000, outMonth: 300, balanceMonth: 700, receivable: 5000, receivableCount: 1 });
  });

  it("aceita só arquivos dos tipos e tamanhos permitidos, conferindo o conteúdo", () => {
    expect(classifyUpload("image/png", 1000)).toEqual({ type: "image" });
    expect(classifyUpload("audio/ogg; codecs=opus", 1000)).toEqual({ type: "audio" });
    expect(classifyUpload("image/png", 11 * 1024 * 1024)).toHaveProperty("error");
    expect(classifyUpload("text/html", 10)).toHaveProperty("error");
    expect(sniffMatches("image", PNG)).toBe(true);
    expect(sniffMatches("document", PNG)).toBe(false);
    expect(sniffMatches("image", Buffer.from("<html><script>"))).toBe(false);
  });

  it("dá permissões de acordo com o perfil", () => {
    expect(can("atendente", "sales:manage")).toBe(true);
    expect(can("atendente", "finance:manage")).toBe(false);
    expect(can("gestor", "finance:manage")).toBe(true);
    expect(can("gestor", "guardian:manage")).toBe(false);
    expect(can("admin", "guardian:manage")).toBe(true);
  });

  it("só restaura backups com a estrutura esperada", () => {
    expect(validateBackup({ version: 1, organizations: [{}], users: [{}], clients: [], deals: [], conversations: [], messages: [], auditLogs: [] })).toBe(true);
    expect(validateBackup({ version: 2, organizations: [{}], users: [{}] })).toBe(false);
    expect(validateBackup({ version: 1, organizations: [], users: [{}], clients: [], deals: [], conversations: [], messages: [], auditLogs: [] })).toBe(false);
    expect(validateBackup("lixo")).toBe(false);
  });
});

describe("fluxo operacional completo (base em memória)", () => {
  let admin: SessionUser, gestor: SessionUser, atendente: SessionUser, clientId: string;
  const as = (role: string) => async () => {
    const db = await getDb();
    const u = db.users.find((x) => x.role === role)!;
    return { ...publicUser(u), orgName: "Ponto Digital" } as SessionUser;
  };
  beforeAll(async () => {
    [admin, gestor, atendente] = await Promise.all([as("admin")(), as("gestor")(), as("atendente")()]);
    clientId = (await getDb()).clients.find((c) => c.orgId === admin.orgId)!.id;
    delete process.env.ANTHROPIC_API_KEY; // sem IA: comprovante fica para digitação
  });
  afterAll(async () => {
    await rm(path.join(process.cwd(), ".data", "arquivos", admin.orgId), { recursive: true, force: true });
  });

  it("venda → comprovante → confirmação → financeiro → produção", async () => {
    const s = await createSale(atendente, { clientId, items: [{ description: "Identidade visual", quantity: 1, unitCents: 150000 }, { description: "Cartão", quantity: 2, unitCents: 10000 }], paymentMethod: "pix", dueDate: null, notes: "" });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.value).toMatchObject({ status: "aguardando_pagamento", totalCents: 170000 });

    const up = await uploadReceipt(gestor, { bytes: PNG, mime: "image/png", filename: "pix.png" }, clientId);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(up.value.analysisError).toMatch(/manualmente/); // sem chave da IA

    // Não confirma sem valor; valor diferente exige aceite explícito
    expect((await confirmReceipt(gestor, up.value.id, s.value.id)).ok).toBe(false);
    await saveReceiptData(gestor, up.value.id, data({ valorCentavos: 160000, idTransacao: "E9988776655" }));
    const diff = await confirmReceipt(gestor, up.value.id, s.value.id);
    expect(diff.ok ? "" : diff.error).toMatch(/diferente/);
    await saveReceiptData(gestor, up.value.id, data({ valorCentavos: 170000, idTransacao: "E9988776655" }));
    const ok = await confirmReceipt(gestor, up.value.id, s.value.id);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.sale.status).toBe("pago");
    expect(ok.value.order?.checklist).toHaveLength(2);

    const entries = await listAll(admin.orgId, "financeEntries", { where: { saleId: s.value.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "entrada", amountCents: 170000, category: "Vendas" });

    // Pagar de novo não duplica
    expect((await markSalePaid(gestor, s.value.id)).ok).toBe(false);

    // O mesmo comprovante (mesmo ID de transação) não confirma outra venda
    const s2 = await createSale(atendente, { clientId, items: [{ description: "Outro", quantity: 1, unitCents: 170000 }], paymentMethod: "pix", dueDate: null, notes: "" });
    const up2 = await uploadReceipt(gestor, { bytes: PNG, mime: "image/png", filename: "pix-copia.png" }, clientId);
    if (!s2.ok || !up2.ok) throw new Error("falha na preparação");
    const saved = await saveReceiptData(gestor, up2.value.id, data({ valorCentavos: 170000, idTransacao: "E9988776655" }));
    expect(saved.ok && saved.value.status).toBe("duplicado");
    expect((await confirmReceipt(gestor, up2.value.id, s2.value.id)).ok).toBe(false);
    expect((await rejectReceipt(gestor, up2.value.id, "Comprovante repetido")).ok).toBe(true);

    // Produção: não entrega com checklist pendente, não pula etapas
    const order = ok.value.order!;
    expect((await moveProduction(atendente, order.id, "entregue")).ok).toBe(false);
    for (const to of ["producao", "revisao"] as const) expect((await moveProduction(atendente, order.id, to)).ok).toBe(true);
    expect((await moveProduction(atendente, order.id, "entregue")).ok).toBe(false);
    await toggleChecklist(atendente, order.id, 0);
    await toggleChecklist(atendente, order.id, 1);
    const delivered = await moveProduction(atendente, order.id, "entregue");
    expect(delivered.ok && delivered.value.deliveredAt).toBeTruthy();

    // Atendente não cancela venda paga; gestor cancela com estorno
    expect((await cancelSale(atendente, s.value.id, "teste")).ok).toBe(false);
    expect((await cancelSale(gestor, s.value.id, "Cliente desistiu")).ok).toBe(true);
    const after = await listAll(admin.orgId, "financeEntries", { where: { saleId: s.value.id } });
    expect(after.map((e) => e.kind).sort()).toEqual(["entrada", "saida"]);

    const db = await getDb();
    expect(db.auditLogs.some((l) => l.action === "comprovante.confirmado")).toBe(true);
    expect(db.auditLogs.some((l) => l.action === "venda.paga")).toBe(true);
  });
});
