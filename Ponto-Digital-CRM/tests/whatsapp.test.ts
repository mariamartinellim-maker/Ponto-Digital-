import { beforeAll, describe, expect, it } from "vitest";
import { applyWhatsAppEvents } from "@/lib/data/repo";
import { getDb } from "@/lib/data/store";
import { sendWhatsApp } from "@/lib/whatsapp/client";
import { parseWebhook } from "@/lib/whatsapp/events";
import { signForTest, verifyMetaSignature } from "@/lib/whatsapp/signature";

const meta = { display_phone_number: "5511900009999", phone_number_id: "PNID" };
const wrap = (field: string, value: object) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field, value: { messaging_product: "whatsapp", metadata: meta, ...value } }] }] });
const ts = String(Math.floor(Date.now() / 1000));

describe("assinatura do webhook (X-Hub-Signature-256)", () => {
  const body = JSON.stringify({ hello: "world" });
  it("aceita assinatura correta", () => {
    expect(verifyMetaSignature(body, signForTest(body, "segredo"), "segredo")).toBe(true);
  });
  it("rejeita assinatura ausente, malformada, de outro segredo ou corpo alterado", () => {
    expect(verifyMetaSignature(body, null, "segredo")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=abc", "segredo")).toBe(false);
    expect(verifyMetaSignature(body, signForTest(body, "outro"), "segredo")).toBe(false);
    expect(verifyMetaSignature(body + " ", signForTest(body, "segredo"), "segredo")).toBe(false);
    expect(verifyMetaSignature(body, signForTest(body, "segredo"), "")).toBe(false);
  });
});

describe("parser de eventos (Cloud API + coexistência)", () => {
  it("lê mensagens, status, ecos do app e histórico", () => {
    const msgs = parseWebhook(wrap("messages", {
      contacts: [{ wa_id: "5511911112222", profile: { name: "Fulano" } }],
      messages: [{ from: "5511911112222", id: "wamid.1", timestamp: ts, type: "text", text: { body: "Oi" } }],
      statuses: [{ id: "wamid.out", status: "read", recipient_id: "5511911112222", timestamp: ts }],
    }));
    expect(msgs[0]!.phoneNumberId).toBe("PNID");
    expect(msgs[0]!.events.map((e) => e.kind)).toEqual(["inbound", "status"]);
    const echo = parseWebhook(wrap("smb_message_echoes", { message_echoes: [{ from: "5511900009999", to: "5511911112222", id: "wamid.e", timestamp: ts, type: "text", text: { body: "Enviei pelo app" } }] }));
    expect(echo[0]!.events[0]).toMatchObject({ kind: "echo", to: "5511911112222", text: "Enviei pelo app" });
    const hist = parseWebhook(wrap("history", { history: [{ metadata: { phase: 0 }, threads: [{ id: "5511911112222", messages: [
      { from: "5511911112222", id: "wamid.h1", timestamp: ts, type: "text", text: { body: "antiga do cliente" } },
      { from: "5511900009999", id: "wamid.h2", timestamp: ts, type: "text", text: { body: "antiga nossa" } },
    ] }] }] }));
    expect(hist[0]!.events.map((e) => e.kind === "history" && e.direction)).toEqual(["in", "out"]);
  });
  it("ignora payloads de outros produtos ou malformados", () => {
    expect(parseWebhook({ object: "page" })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ object: "whatsapp_business_account", entry: "x" })).toEqual([]);
  });
});

describe("processamento idempotente e descadastro", () => {
  let orgId: string;
  beforeAll(async () => {
    orgId = (await getDb()).organizations[0]!.id;
  });

  it("cria cliente/conversa para número novo e não duplica reentregas", async () => {
    const payload = wrap("messages", {
      contacts: [{ wa_id: "5511977776666", profile: { name: "Cliente Novo" } }],
      messages: [{ from: "5511977776666", id: "wamid.dup", timestamp: ts, type: "text", text: { body: "Olá" } }],
    });
    const a = await applyWhatsAppEvents(orgId, parseWebhook(payload));
    const b = await applyWhatsAppEvents(orgId, parseWebhook(payload));
    expect(a.inbound).toBe(1);
    expect(b.duplicates).toBe(1);
    const db = await getDb();
    const client = db.clients.find((c) => c.phone === "5511977776666")!;
    expect(client.name).toBe("Cliente Novo");
    const conv = db.conversations.find((c) => c.clientId === client.id)!;
    expect(db.messages.filter((m) => m.conversationId === conv.id)).toHaveLength(1);
    expect(conv.lastInboundAt).not.toBeNull();
  });

  it("registra mensagens enviadas pelo App Business como origem app_business", async () => {
    await applyWhatsAppEvents(orgId, parseWebhook(wrap("smb_message_echoes", { message_echoes: [{ from: "5511900009999", to: "5511977776666", id: "wamid.echo1", timestamp: ts, type: "text", text: { body: "Respondi pelo celular" } }] })));
    const db = await getDb();
    expect(db.messages.find((m) => m.waMessageId === "wamid.echo1")?.origin).toBe("app_business");
  });

  it("descadastra quem envia SAIR", async () => {
    await applyWhatsAppEvents(orgId, parseWebhook(wrap("messages", { messages: [{ from: "5511977776666", id: "wamid.sair", timestamp: ts, type: "text", text: { body: "SAIR" } }] })));
    const db = await getDb();
    const client = db.clients.find((c) => c.phone === "5511977776666")!;
    expect(client.consent.status).toBe("opt_out");
    expect(db.consentEvents.some((e) => e.clientId === client.id && e.source === "palavra_chave")).toBe(true);
  });

  it("atualiza o status das mensagens enviadas", async () => {
    await applyWhatsAppEvents(orgId, parseWebhook(wrap("messages", { statuses: [{ id: "wamid.echo1", status: "read", recipient_id: "5511977776666", timestamp: ts }] })));
    const db = await getDb();
    expect(db.messages.find((m) => m.waMessageId === "wamid.echo1")?.status).toBe("lida");
  });
});

describe("envio protegido", () => {
  it("nunca envia de verdade durante testes, mesmo com WHATSAPP_SEND_MODE=live", async () => {
    const r = await sendWhatsApp({ type: "text", to: "5511900000000", body: "teste" }, { campaign: true });
    expect(r).toMatchObject({ ok: true, simulated: true });
  });
});
