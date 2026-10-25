import { createHmac } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

/*
 * Persistência dos módulos operacionais no MODO SUPABASE, contra um PostgreSQL local com PostgREST
 * (mesma API do supabase-js) e as políticas RLS reais das migrações. Roda só via
 * scripts/testes/supabase-rest.sh (que define PGRST_URL); nos demais casos é ignorado.
 */
const URL = process.env.PGRST_URL ?? "";
const SECRET = process.env.PGRST_JWT_SECRET ?? "";
const ORG = "00000000-0000-0000-0000-00000000000a";
const OTHER_ORG = "00000000-0000-0000-0000-00000000000b";
const CLIENT = "00000000-0000-0000-0000-0000000000c1";
const OTHER_CLIENT = "00000000-0000-0000-0000-0000000000c2";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(claims: object) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
const clientFor = (claims: object) => new PostgrestClient(URL, { headers: { Authorization: `Bearer ${jwt(claims)}` } });

// Usuário da "sessão" atual: cada chamada ao banco usa o token dele (RLS aplicada pelo PostgreSQL).
const current: { sub: string } = { sub: "" };
vi.mock("@/lib/supabase/server", () => ({
  isSupabase: () => true,
  supabaseServer: async () => clientFor({ role: "authenticated", sub: current.sub }),
  dbError: (e: { message?: string } | null) => e?.message ?? "erro",
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdmin: () => true,
  supabaseAdmin: () => clientFor({ role: "service_role" }),
}));
// Arquivos ficam no Supabase Storage (fora deste teste): sem arquivo, o comprovante vai para digitação.
vi.mock("@/lib/media/storage", () => ({ getFile: async () => null, saveAsset: async () => ({ error: "sem storage no teste" }) }));

const user = (id: string, role: SessionUser["role"], orgId = ORG): SessionUser =>
  ({ id, orgId, role, name: role, email: `${role}@a.test`, active: true, createdAt: "", lastLoginAt: null, orgName: "Teste" }) as unknown as SessionUser;
const ADMIN = user("00000000-0000-0000-0000-0000000000a1", "admin");
const ATENDENTE = user("00000000-0000-0000-0000-0000000000a2", "atendente");
const GESTOR = user("00000000-0000-0000-0000-0000000000a4", "gestor");
const OUTRA = user("00000000-0000-0000-0000-0000000000b1", "admin", OTHER_ORG);
const as = (u: SessionUser) => (current.sub = u.id);

describe.skipIf(!URL)("modo Supabase via PostgREST (RLS real)", () => {
  beforeEach(() => as(ADMIN));

  it("venda → comprovante → confirmação → financeiro → produção, gravado no PostgreSQL", async () => {
    const svc = await import("@/lib/business/service");
    const col = await import("@/lib/data/collections");

    as(ATENDENTE);
    const sale = await svc.createSale(ATENDENTE, { clientId: CLIENT, items: [{ description: "Logotipo", quantity: 1, unitCents: 150000 }], paymentMethod: "pix", dueDate: null, notes: "" });
    expect(sale.ok ? sale.value : sale.error).toMatchObject({ number: 1, status: "aguardando_pagamento", totalCents: 150000 });
    if (!sale.ok) return;
    // Atendente não dá baixa (regra do serviço e do banco)
    const forged = await col.updateOne(ORG, "sales", sale.value.id, { status: "pago", paidAt: new Date().toISOString() }).catch((e: Error) => e);
    expect(forged instanceof Error || forged === null).toBe(true);
    expect((await col.listAll(ORG, "receipts")).length).toBe(0); // atendente não vê comprovantes

    as(GESTOR);
    const asset = await col.insertOne("mediaAssets", {
      id: crypto.randomUUID(), orgId: ORG, title: "Comprovante", type: "image", mime: "image/png", size: 68, filename: "pix.png", tags: ["comprovante"],
      source: "upload", clientId: CLIENT, storageKey: `${ORG}/x/pix.png`, createdBy: GESTOR.id, createdAt: new Date().toISOString(),
    });
    const rec = await svc.receiptFromAsset(GESTOR, asset.id, CLIENT);
    expect(rec.ok ? rec.value.analysisError : rec.error).toBe("Arquivo não encontrado.");
    if (!rec.ok) return;
    await svc.saveReceiptData(GESTOR, rec.value.id, { valorCentavos: 150000, dataPagamento: "2026-10-26", pagador: "Cliente A", recebedor: null, banco: null, metodo: "pix", idTransacao: "E2ESUPABASE0001", confianca: 1, observacao: "" });
    const conf = await svc.confirmReceipt(GESTOR, rec.value.id, sale.value.id);
    expect(conf.ok ? conf.value.sale.status : conf.error).toBe("pago");
    if (!conf.ok) return;
    expect(conf.value.order).toMatchObject({ number: 1, stage: "fila", saleId: sale.value.id });

    const entries = await col.listAll(ORG, "financeEntries");
    expect(entries).toEqual([expect.objectContaining({ kind: "entrada", amountCents: 150000, saleId: sale.value.id, category: "Vendas" })]);
    expect((await col.getOne(ORG, "receipts", rec.value.id))).toMatchObject({ status: "confirmado", saleId: sale.value.id, reviewedBy: GESTOR.id });

    // Produção pela atendente: avança, conclui checklist e entrega; depois fica travada
    as(ATENDENTE);
    const order = conf.value.order!;
    for (const to of ["producao", "revisao"] as const) expect((await svc.moveProduction(ATENDENTE, order.id, to)).ok).toBe(true);
    expect((await svc.toggleChecklist(ATENDENTE, order.id, 0)).ok).toBe(true);
    const delivered = await svc.moveProduction(ATENDENTE, order.id, "entregue");
    expect(delivered.ok && delivered.value.stage).toBe("entregue");
    const locked = await col.updateOne(ORG, "productionOrders", order.id, { stage: "producao" }).catch(() => null);
    expect(locked).toBeNull();

    // Auditoria gravada com o usuário de cada ação
    const audits = await clientFor({ role: "service_role" }).from("audit_logs").select("action,user_id").eq("org_id", ORG);
    const actions = (audits.data ?? []).map((a) => `${a.action}:${a.user_id}`);
    expect(actions).toContain(`venda.criada:${ATENDENTE.id}`);
    expect(actions).toContain(`comprovante.confirmado:${GESTOR.id}`);
    expect(actions).toContain(`venda.paga:${GESTOR.id}`);
  });

  it("isola as organizações", async () => {
    const svc = await import("@/lib/business/service");
    const col = await import("@/lib/data/collections");
    as(OUTRA);
    expect(await col.listAll(ORG, "sales")).toEqual([]);
    expect(await col.listAll(OTHER_ORG, "sales")).toEqual([]);
    const cross = await svc.createSale(OUTRA, { clientId: CLIENT, items: [{ description: "X", quantity: 1, unitCents: 100 }], paymentMethod: "pix", dueDate: null, notes: "" });
    expect(cross.ok).toBe(false); // cliente de outra organização: invisível
    const own = await svc.createSale(OUTRA, { clientId: OTHER_CLIENT, items: [{ description: "Y", quantity: 1, unitCents: 100 }], paymentMethod: "pix", dueDate: null, notes: "" });
    expect(own.ok && own.value.number).toBe(1); // numeração própria por organização
  });

  it("Guardian grava eventos pelo servidor; só o admin da organização lê", async () => {
    const g = await import("@/lib/guardian/guardian");
    await g.recordEvent("aviso", "teste", "Evento de teste", ORG);
    expect((await g.recentEvents(ORG)).some((e) => e.message === "Evento de teste")).toBe(true);
    as(GESTOR);
    const viaUser = await clientFor({ role: "authenticated", sub: GESTOR.id }).from("guardian_events").select("id");
    expect(viaUser.data).toEqual([]);
  });
});
