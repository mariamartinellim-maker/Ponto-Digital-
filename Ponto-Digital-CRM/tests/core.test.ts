import { describe, expect, it } from "vitest";
import { analyzeCsv } from "@/lib/csv";
import { normalizePhone, phoneDedupKey } from "@/lib/phone";
import { can } from "@/lib/permissions";
import { isOptOutMessage, renderTemplate, resolveAudience, templateVariableCount } from "@/lib/segmentation";
import { signSession, verifySession } from "@/lib/auth/token";
import type { Client, Deal } from "@/lib/data/types";

describe("telefones", () => {
  it("normaliza formatos brasileiros para E.164", () => {
    expect(normalizePhone("(11) 99999-0000")).toBe("5511999990000");
    expect(normalizePhone("+55 19 3333-4444")).toBe("551933334444");
    expect(normalizePhone("011 99999 0000")).toBe("5511999990000");
    expect(normalizePhone("0055 11 99999-0000")).toBe("5511999990000");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("(00) 99999-0000")).toBeNull();
  });
  it("trata números com e sem o nono dígito como o mesmo contato", () => {
    expect(phoneDedupKey("5511999990000")).toBe(phoneDedupKey("551199990000"));
  });
});

describe("importação CSV", () => {
  const csv = [
    "Nome;Telefone;Cidade;Serviços;Consentimento",
    "Loja A;(11) 99999-0001;São Paulo;SEO|Tráfego Pago;sim",
    "Loja A repetida;11 999990001;São Paulo;;",
    "Loja B;11 9999-0002;Campinas;;não",
    "Loja C;abc;;;",
    ";11 98888-7777;;;",
    "Loja D;19 98888-0000;;;",
  ].join("\n");

  it("elimina duplicidades no arquivo e com a base existente", () => {
    const r = analyzeCsv(csv, ["5519988880000"]);
    expect(r.valid.map((v) => v.name)).toEqual(["Loja A", "Loja B"]);
    expect(r.duplicatesInFile).toHaveLength(1);
    expect(r.duplicatesInFile[0]!.firstLine).toBe(2);
    expect(r.alreadyExists.map((x) => x.name)).toEqual(["Loja D"]);
    expect(r.invalid).toHaveLength(2);
    expect(r.valid[0]!.services).toEqual(["SEO", "Tráfego Pago"]);
    expect(r.valid[0]!.consent).toBe(true);
    expect(r.valid[1]!.consent).toBe(false);
  });
  it("exige colunas de nome e telefone", () => {
    const r = analyzeCsv("a,b\n1,2", []);
    expect(r.valid).toHaveLength(0);
    expect(r.invalid[0]!.reason).toMatch(/nome/);
  });
});

describe("segmentação de campanhas (LGPD)", () => {
  const base = { orgId: "o", email: "", tags: [], notes: "", ownerId: null, createdAt: "", updatedAt: "", lastContactAt: null };
  const clients: Client[] = [
    { ...base, id: "1", name: "A", phone: "1", city: "Campinas", services: ["SEO"], consent: { status: "opt_in", source: "manual", at: "" } },
    { ...base, id: "2", name: "B", phone: "2", city: "Campinas", services: ["SEO"], consent: { status: "opt_out", source: "manual", at: "" } },
    { ...base, id: "3", name: "C", phone: "3", city: "campinas", services: ["SEO"], consent: { status: "desconhecido", source: null, at: null } },
    { ...base, id: "4", name: "D", phone: "4", city: "Santos", services: ["SEO"], consent: { status: "opt_in", source: "manual", at: "" } },
  ];
  const deals = [{ clientId: "1", stage: "fechado" }, { clientId: "4", stage: "novo_lead" }] as Deal[];

  it("só inclui contatos com opt-in e nunca descadastrados", () => {
    const r = resolveAudience({ cities: ["Campinas"], services: [], stages: [], tags: [] }, clients, deals);
    expect(r.eligible.map((c) => c.id)).toEqual(["1"]);
    expect(r.excludedOptOut.map((c) => c.id)).toEqual(["2"]);
    expect(r.excludedNoConsent.map((c) => c.id)).toEqual(["3"]);
  });
  it("filtra por etapa do funil", () => {
    const r = resolveAudience({ cities: [], services: [], stages: ["novo_lead"], tags: [] }, clients, deals);
    expect(r.eligible.map((c) => c.id)).toEqual(["4"]);
  });
  it("renderiza variáveis de template", () => {
    expect(renderTemplate("Olá, {{1}}! Até {{2}}.", ["Ana", "amanhã"])).toBe("Olá, Ana! Até amanhã.");
    expect(templateVariableCount("{{1}} e {{3}}")).toBe(3);
  });
  it("reconhece pedidos de descadastro", () => {
    for (const t of ["SAIR", "sair.", " Parar ", "STOP", "descadastrar"]) expect(isOptOutMessage(t)).toBe(true);
    for (const t of ["quero sair do plano mensal?", "obrigado"]) expect(isOptOutMessage(t)).toBe(false);
  });
});

describe("permissões", () => {
  it("restringe áreas administrativas", () => {
    expect(can("admin", "users:manage")).toBe(true);
    expect(can("gestor", "users:manage")).toBe(false);
    expect(can("gestor", "campaigns:manage")).toBe(true);
    expect(can("atendente", "campaigns:manage")).toBe(false);
    expect(can("atendente", "clients:delete")).toBe(false);
    expect(can("atendente", "inbox:read_all")).toBe(false);
  });
});

describe("sessão assinada", () => {
  const secret = "x".repeat(40);
  it("aceita token válido e rejeita adulterado ou expirado", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signSession({ uid: "u", org: "o", sv: 1, exp }, secret);
    expect((await verifySession(token, secret))?.uid).toBe("u");
    expect(await verifySession(token, "y".repeat(40))).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", org: "o", sv: 1, exp })).toString("base64url");
    expect(await verifySession(`${forged}.${sig}`, secret)).toBeNull();
    expect(body).toBeTruthy();
    const old = await signSession({ uid: "u", org: "o", sv: 1, exp: 1 }, secret);
    expect(await verifySession(old, secret)).toBeNull();
  });
});
