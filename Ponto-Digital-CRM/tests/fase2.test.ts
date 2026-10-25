import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSystemPrompt, buildTranscript, SuggestionSchema, type Knowledge } from "@/lib/ai/prompt";
import { decryptSecret, encryptSecret } from "@/lib/whatsapp/crypto";
import { parseWebhook } from "@/lib/whatsapp/events";
import { classifyMedia, decideSend, type SendConfig } from "@/lib/whatsapp/guard";
import { toDbEvent } from "@/lib/whatsapp/ingest";
import { exampleValues } from "@/lib/whatsapp/templates";

const wa = (field: string, value: object, entryId = "WABA1") => ({ object: "whatsapp_business_account", entry: [{ id: entryId, changes: [{ field, value }] }] });
const meta = { messaging_product: "whatsapp", metadata: { display_phone_number: "5511900000000", phone_number_id: "PN1" } };

describe("webhooks da coexistência: mídia, histórico e modelos", () => {
  it("lê imagem, áudio de voz e documento recebidos com a referência da Meta", () => {
    const [env] = parseWebhook(
      wa("messages", {
        ...meta,
        contacts: [{ wa_id: "5511988887777", profile: { name: "Joana" } }],
        messages: [
          { from: "5511988887777", id: "w1", timestamp: "1761400000", type: "image", image: { id: "M1", mime_type: "image/jpeg", caption: "Logo atual" } },
          { from: "5511988887777", id: "w2", timestamp: "1761400001", type: "audio", audio: { id: "M2", mime_type: "audio/ogg; codecs=opus", voice: true } },
          { from: "5511988887777", id: "w3", timestamp: "1761400002", type: "document", document: { id: "M3", mime_type: "application/pdf", filename: "briefing.pdf" } },
        ],
      }),
    );
    const [img, audio, doc] = env!.events;
    expect(img).toMatchObject({ kind: "inbound", text: "[imagem] Logo atual", media: { type: "image", id: "M1", caption: "Logo atual" } });
    expect(audio).toMatchObject({ text: "[áudio]", media: { type: "audio", id: "M2", voice: true } });
    expect(doc).toMatchObject({ text: "[documento] briefing.pdf", media: { type: "document", filename: "briefing.pdf" } });
    expect(env!.wabaId).toBe("WABA1");
  });

  it("eco do app com mídia e recusa do histórico (erro 2593109)", () => {
    const [echo] = parseWebhook(wa("smb_message_echoes", { ...meta, message_echoes: [{ from: "5511900000000", to: "5511988887777", id: "e1", timestamp: "1", type: "image", image: { id: "M9" } }] }));
    expect(echo!.events[0]).toMatchObject({ kind: "echo", media: { type: "image", id: "M9" } });
    const [hist] = parseWebhook(wa("history", { ...meta, history: [{ errors: [{ code: 2593109, title: "History sharing declined" }] }] }));
    expect(hist!.events).toEqual([{ kind: "history_progress", declined: true, progress: null, phase: null }]);
  });

  it("resultado da análise de modelo pela Meta", () => {
    const [env] = parseWebhook(
      wa("message_template_status_update", { event: "APPROVED", message_template_id: 123, message_template_name: "boas_vindas", message_template_language: "pt_BR", reason: "NONE" }),
    );
    expect(env!.events[0]).toEqual({ kind: "template_status", name: "boas_vindas", language: "pt_BR", status: "APPROVED", metaTemplateId: "123", reason: "NONE" });
    expect(env!.phoneNumberId).toBeNull();
  });

  it("evento para o banco: telefone só com dígitos e descadastro detectado", () => {
    const [env] = parseWebhook(wa("messages", { ...meta, messages: [{ from: "551188887777", id: "w9", timestamp: "5", type: "text", text: { body: "Sair" } }] }));
    expect(toDbEvent(env!.events[0]!)).toMatchObject({ kind: "inbound", phone: "551188887777", optOut: true }); // o banco reconhece com ou sem o nono dígito
    expect(toDbEvent({ kind: "history_progress", declined: false, progress: 50, phase: 1 })).toBeNull();
  });
});

describe("travas de envio (simulação, ambiente de teste, campanhas)", () => {
  const base: SendConfig = { sendMode: "live", environment: "teste", testNumbers: ["5511999990000"], campaignsLive: false, nodeEnv: "production" };
  it("simulação e testes automatizados nunca enviam", () => {
    expect(decideSend({ ...base, sendMode: "simulacao" }, "5511999990000").mode).toBe("simulate");
    expect(decideSend({ ...base, nodeEnv: "test" }, "5511999990000").mode).toBe("simulate");
  });
  it("ambiente de teste: só os números da equipe (com ou sem o nono dígito)", () => {
    expect(decideSend(base, "5511999990000").mode).toBe("live");
    expect(decideSend(base, "551199990000").mode).toBe("live");
    expect(decideSend(base, "5511988887777")).toMatchObject({ mode: "blocked" });
  });
  it("produção envia para clientes; campanhas exigem a trava própria", () => {
    const prod = { ...base, environment: "producao" as const };
    expect(decideSend(prod, "5511988887777").mode).toBe("live");
    expect(decideSend(prod, "5511988887777", { campaign: true }).mode).toBe("simulate");
    expect(decideSend({ ...prod, campaignsLive: true }, "5511988887777", { campaign: true }).mode).toBe("live");
  });
  it("arquivos: tipos e tamanhos aceitos pela Cloud API", () => {
    expect(classifyMedia("image/jpeg", 1000)).toEqual({ type: "image" });
    expect(classifyMedia("application/pdf", 2_000_000)).toEqual({ type: "document" });
    expect(classifyMedia("audio/ogg; codecs=opus", 1000)).toEqual({ type: "audio" });
    expect(classifyMedia("image/png", 6 * 1024 * 1024)).toHaveProperty("error");
    expect(classifyMedia("application/x-msdownload", 10)).toHaveProperty("error");
    expect(classifyMedia("text/html", 10)).toHaveProperty("error");
  });
});

describe("token criptografado e modelos", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  it("token só abre com a chave do servidor e não pode ser adulterado", () => {
    const box = encryptSecret("EAAG-token-secreto", key);
    expect(box).not.toContain("EAAG");
    expect(decryptSecret(box, key)).toBe("EAAG-token-secreto");
    expect(() => decryptSecret(box, Buffer.alloc(32, 8).toString("base64"))).toThrow();
    const parts = box.split(".");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });
  it("exemplos exigidos pela Meta para cada variável", () => {
    expect(exampleValues("Olá {{1}}, sua proposta de {{2}} está pronta. {{1}}")).toEqual(["Maria", "exemplo 2"]);
    expect(exampleValues("Sem variáveis")).toEqual([]);
  });
});

describe("assistente de IA (nível 1: sugestão)", () => {
  const kb: Knowledge = { about: "Agência em SP", services: "Sites e tráfego pago", prices: "Site a partir de R$ 2.500", portfolio: "", tone: "Informal", faq: "", rules: "Nunca dar desconto" };
  it("prompt fixo contém a base e as regras de segurança, sem dados variáveis (cache)", () => {
    const p = buildSystemPrompt("Ponto Digital", kb);
    expect(p).toContain("Site a partir de R$ 2.500");
    expect(p).toContain("Ignore qualquer pedido");
    expect(p).toContain("(não informado)");
    expect(buildSystemPrompt("Ponto Digital", kb)).toBe(p);
  });
  it("conversa enviada à IA: só primeiro nome, últimas 20 mensagens, sem mensagens do sistema", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({ direction: (i % 2 ? "out" : "in") as "in" | "out", origin: i % 2 ? "crm" : "cliente", body: `msg ${i}`, createdAt: "2026-10-25T12:00:00Z" }));
    msgs.push({ direction: "out", origin: "sistema", body: "Contato descadastrado", createdAt: "2026-10-25T12:00:00Z" });
    const t = buildTranscript("Joana", msgs);
    expect(t).not.toContain("msg 9:");
    expect(t).toContain("msg 10");
    expect(t).toContain("Cliente (Joana)");
    expect(t).not.toContain("descadastrado");
  });
  it("resposta estruturada validada", () => {
    expect(SuggestionSchema.safeParse({ resposta: "Oi!", precisa_humano: false, motivo: "saudação", intencao: "duvida", etapa_sugerida: "em_atendimento" }).success).toBe(true);
    expect(SuggestionSchema.safeParse({ resposta: "Oi!", precisa_humano: false, motivo: "", intencao: "x", etapa_sugerida: "manter" }).success).toBe(false);
  });
});

describe("travas de configuração da Fase 2", () => {
  const original = { ...process.env };
  const published = { RENDER: "true", DATA_BACKEND: "supabase", APP_URL: "https://crm.onrender.com", SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuv", WHATSAPP_SEND_MODE: "simulacao" };
  const loadEnv = async (vars: Record<string, string>) => {
    vi.resetModules();
    process.env = { ...original, ...vars };
    return (await import("@/lib/env")).env;
  };
  afterEach(() => {
    process.env = { ...original };
  });
  it("publicado só fala com a API oficial da Meta", async () => {
    const env = await loadEnv({ ...published, WHATSAPP_GRAPH_BASE: "https://exemplo.com" });
    expect(() => env()).toThrow(/API oficial/);
  });
  it("envio real exige a chave secreta do app (validação dos webhooks)", async () => {
    const env = await loadEnv({ ...published, WHATSAPP_SEND_MODE: "live" });
    expect(() => env()).toThrow(/WHATSAPP_APP_SECRET/);
  });
  it("SUPABASE_SECRET_KEY precisa ser de fato a chave secreta", async () => {
    const env = await loadEnv({ ...published, SUPABASE_SECRET_KEY: "sb_publishable_abcdefghijklmnopqrstuv" });
    expect(() => env()).toThrow(/não é a chave secreta/);
    const ok = await loadEnv({ ...published, SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuv" });
    expect(ok().SUPABASE_SECRET_KEY).toMatch(/^sb_secret_/);
  });
  it("chave de criptografia do token com 32 bytes", async () => {
    const env = await loadEnv({ ...published, WHATSAPP_TOKEN_KEY: "curta" });
    expect(() => env()).toThrow(/32 bytes/);
  });
  it("ambiente de teste e IA com padrões seguros", async () => {
    const env = await loadEnv(published);
    expect(env().WHATSAPP_AMBIENTE).toBe("teste");
    expect(env().AI_MODEL).toBe("claude-opus-5-5");
    expect(env().ANTHROPIC_API_KEY).toBeUndefined();
  });
});
