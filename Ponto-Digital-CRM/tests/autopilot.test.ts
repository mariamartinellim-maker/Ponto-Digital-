import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listAll } from "@/lib/data/collections";
import { applyWhatsAppEvents } from "@/lib/data/repo";
import { getDb } from "@/lib/data/store";
import type { VideoOrder } from "@/lib/data/types";
import { classifyReply, detectModality, fallbackDraft, keywordIntent } from "@/lib/video/brain";
import { crc16, normalizePixKey, pixCopyPaste } from "@/lib/pix";
import { ffmpegPath } from "@/lib/video/ffmpeg";
import { greeting, runAutopilot, saveSettings, TAG_DONE, TAG_NEW, TEXTS } from "@/lib/video/autopilot";
import type { WaEnvelope, WaMedia } from "@/lib/whatsapp/events";

// Comprovante: a leitura pela IA é simulada aqui (nos testes não há chave nem chamadas externas).
vi.mock("@/lib/ai/receipt", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/receipt")>()),
  analyzeReceipt: vi.fn(async (_bytes: Uint8Array, mime: string) => ({
    ok: true,
    model: "teste",
    isReceipt: mime === "image/png",
    data: { valorCentavos: 5000, dataPagamento: null, pagador: null, recebedor: null, banco: null, metodo: "pix", idTransacao: null, confianca: 0.9, observacao: "" },
  })),
}));
// A leitura do comprovante exige a chave da IA: ligada só no passo do comprovante (o resto roda sem IA).
const ai = vi.hoisted(() => ({ key: undefined as string | undefined }));
vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, env: () => ({ ...mod.env(), ANTHROPIC_API_KEY: ai.key }) };
});

const JPG = execFileSync(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=1", "-frames:v", "1", "-f", "mjpeg", "pipe:1"]);
const PNG = execFileSync(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=200x300", "-frames:v", "1", "-f", "image2", "-c:v", "png", "pipe:1"]);

describe("Pix copia e cola", () => {
  it("gera o BR Code oficial (CRC do exemplo do Banco Central) e reconhece o tipo da chave", () => {
    expect(crc16("00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304")).toBe("1D3D");
    expect(normalizePixKey("082.454.761-61")).toEqual({ key: "08245476161", type: "CPF" });
    expect(normalizePixKey("Pix@Ponto.com")).toEqual({ key: "pix@ponto.com", type: "EMAIL" });
    expect(normalizePixKey("+55 65 99999-0000")).toEqual({ key: "+5565999990000", type: "PHONE" });
    expect(normalizePixKey("123")).toBeNull();
    const code = pixCopyPaste({ key: "08245476161", name: "Maria de Fátima Martineli", city: "Cuiabá", amountCents: 3500, txid: "video12" });
    expect(code).toContain("0111082454761615204000053039865405" + "35.00");
    expect(code).toContain("5925MARIA DE FATIMA MARTINELI6006CUIABA");
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)));
  });
});

describe("cérebro do robô (sem IA)", () => {
  it("entende a modalidade e a resposta do cliente", async () => {
    expect(detectModality("é pra táxi")).toBe("taxi");
    expect(detectModality("trabalho no Uber e na 99")).toBe("uber");
    expect(detectModality("taxi e uber")).toBeNull();
    expect(detectModality("oi")).toBeNull();
    expect(keywordIntent("Pode continuar!")).toEqual({ intent: "aprovado" });
    expect(keywordIntent("ok mas muda a camisa")).toMatchObject({ intent: "ajuste" });
    expect(keywordIntent("troca a cor do carro pra branco")).toMatchObject({ intent: "ajuste", ajuste: "troca a cor do carro pra branco" });
    expect(keywordIntent("quanto tempo demora?")).toEqual({ intent: "outro" });
    expect(await classifyReply("perfeito", "avatar")).toEqual({ intent: "aprovado" });
    expect(fallbackDraft({ modality: "taxi", clientName: "Benner Dias", text: "" })).toMatchObject({ driverName: "Benner Táxi" });
  });

  it("cumprimenta conforme a hora de Cuiabá", () => {
    expect(greeting(new Date("2026-10-28T12:00:00Z"))).toMatch(/bom dia/); // 08h
    expect(greeting(new Date("2026-10-28T19:00:00Z"))).toMatch(/boa tarde/); // 15h
    expect(greeting(new Date("2026-10-29T01:00:00Z"))).toMatch(/boa noite/); // 21h
  });
});

describe("atendimento automático completo (base em memória, simulador)", () => {
  let orgId: string;
  const PHONE = "5565988776655";
  let n = 0;
  const inbound = (text: string, media: WaMedia | null = null, fromAd = false): WaEnvelope[] => [
    { phoneNumberId: null, displayPhone: null, field: "messages", events: [{ kind: "inbound", waMessageId: `wamid.T${++n}`, from: PHONE, profileName: "Benner Dias", text, timestamp: Math.floor(Date.now() / 1000), media, ...(fromAd ? { fromAd } : {}) }] },
  ];
  const fetcher = () => async (m: WaMedia) => (m.id === "foto" ? { bytes: JPG, mime: "image/jpeg" } : { bytes: m.id === "comprovante" ? PNG : JPG, mime: m.id === "comprovante" ? "image/png" : "image/jpeg" });
  const send = async (envl: WaEnvelope[]) => {
    await applyWhatsAppEvents(orgId, envl);
    await runAutopilot(envl, () => orgId, fetcher);
  };
  const conv = async () => {
    const db = await getDb();
    const client = db.clients.find((c) => c.orgId === orgId && c.phone === PHONE)!;
    return { client, conv: db.conversations.find((c) => c.clientId === client.id)!, db };
  };
  const outTexts = async () => {
    const { conv: c, db } = await conv();
    return db.messages.filter((m) => m.conversationId === c.id && m.direction === "out").map((m) => m.body);
  };
  const order = async () => (await listAll(orgId, "videoOrders", { admin: true })).find((o) => o.driverName && o.autopilot)!;
  const waitOrder = async (status: VideoOrder["status"]) => {
    for (let i = 0; i < 160; i++) {
      const o = await order();
      if (o?.status === status) return o;
      await new Promise((r) => setTimeout(r, 250));
    }
    const last = await order();
    throw new Error(`pedido não chegou em ${status}: ${last?.status} ${last?.error ?? ""}`);
  };

  beforeAll(async () => {
    orgId = (await getDb()).organizations[0]!.id;
    await saveSettings(orgId, "u", { enabled: true, trigger: "anuncio", testOnly: false, priceText: "R$ 35", pixKey: "082.454.761-61", pixHolder: "Maria de Fatima Martineli", pixCity: "Cuiaba", audioAskAssetId: null, audioPhotoAssetId: null });
  });
  afterAll(async () => {
    await rm(path.join(process.cwd(), ".data", "arquivos", orgId), { recursive: true, force: true });
  });

  it("anúncio → Uber ou táxi → foto e informações → avatar → aprovação → prévia + Pix → comprovante → vídeo final", async () => {
    await send(inbound("Olá! Tenho interesse e queria mais informações, por favor.", null, true));
    expect(await outTexts()).toEqual([greeting(), TEXTS.ask]);
    expect((await conv()).client.tags).toContain(TAG_NEW);

    await send(inbound("é pra táxi"));
    expect((await outTexts()).at(-1)).toBe(TEXTS.photo);

    await send(inbound("[imagem]", { type: "image", id: "foto", mime: "image/jpeg" }));
    expect((await outTexts()).at(-1)).toBe(TEXTS.needInfo);

    await send(inbound("Benner, atendo em Cuiabá e Várzea Grande, meu zap 65 99999-0000. Faço corridas pro aeroporto, viagens pro interior, carro com ar, água gelada, aceito cartão e Pix, atendo 24 horas todos os dias"));
    let texts = await outTexts();
    expect(texts.at(-3)).toBe(TEXTS.condensed); // mandou mais do que cabe: explica que enxugou
    expect(texts.at(-2)).toMatch(/^Olha o roteiro do seu vídeo:\n\n\*Fala:\* "Precisando de táxi\?/);
    expect(texts.at(-2)).toContain("*Nome no final:* Benner Táxi");
    expect(texts.at(-1)).toBe(TEXTS.scriptHint);
    expect(await listAll(orgId, "videoOrders", { admin: true, where: { autopilot: true } })).toHaveLength(0); // nada gerado antes de aprovar o roteiro

    await send(inbound("pode continuar"));
    expect((await outTexts()).at(-1)).toBe(TEXTS.creating);
    const sentAvatar = await waitOrder("avatar_enviado");
    expect(sentAvatar).toMatchObject({ modality: "taxi", driverName: "Benner Táxi", autopilot: true });
    expect((await outTexts()).at(-1)).toMatch(/^\[imagem\] Olha como ficou/);

    await send(inbound("quanto tempo demora?")); // fora do roteiro: explica como aprovar
    expect((await outTexts()).at(-1)).toBe(TEXTS.approveHint);

    await send(inbound("troca a camisa pra azul"));
    expect((await outTexts()).at(-1)).toBe(TEXTS.adjusting);
    await waitOrder("avatar_enviado");
    expect((await order()).avatarRuns).toBe(2);
    expect((await order()).adjustments).toBe("troca a camisa pra azul");

    await send(inbound("pode continuar"));
    expect((await outTexts()).at(-1)).toBe(TEXTS.animating);
    await waitOrder("aguardando_pagamento");
    for (let i = 0; i < 40 && !(await outTexts()).at(-1)?.includes("comprovante"); i++) await new Promise((r) => setTimeout(r, 100));
    texts = await outTexts();
    expect(texts.at(-4)).toMatch(/^\[vídeo\] Prontinho, essa é a prévia/);
    // Cartão de cobrança Pix (titular + botão copiar), como no WhatsApp Business.
    expect(texts.slice(-3)).toEqual([
      "Pra liberar o vídeo sem a marca d'água fica R$ 35. Segue a chave Pix:",
      "[Pix] Maria de Fatima Martineli · CPF: 082.454.761-61 · R$ 35 (copiar chave Pix)",
      "Me manda o comprovante aqui que já te envio",
    ]);

    ai.key = "chave-de-teste";
    await send(inbound("[imagem]", { type: "image", id: "outra", mime: "image/jpeg" })); // foto qualquer não libera
    expect((await outTexts()).at(-1)).toBe(TEXTS.notReceipt);
    expect((await order()).status).toBe("aguardando_pagamento");

    await send(inbound("[imagem]", { type: "image", id: "comprovante", mime: "image/png" }));
    const done = await order();
    expect(done).toMatchObject({ status: "entregue" });
    expect(done.receiptAssetId).not.toBeNull();
    const final = await outTexts();
    expect(final.at(-2)).toMatch(/^\[vídeo\] Prontinho! Aqui está o seu vídeo sem a marca/);
    expect(final.at(-1)).toBe(TEXTS.thanks);
    const st = (await listAll(orgId, "videoAutopilotStates", { admin: true }))[0]!;
    expect(st.stage).toBe("finalizado");
    expect((await conv()).client.tags).toEqual(expect.arrayContaining([TAG_DONE]));
    expect((await conv()).client.tags).not.toContain(TAG_NEW);

    // Depois de finalizado, o robô não responde mais.
    const count = final.length;
    await send(inbound("valeu!"));
    expect((await outTexts()).length).toBe(count);

    const { db, conv: c } = await conv();
    const msgs = db.messages.filter((m) => m.conversationId === c.id && m.direction === "out");
    expect(msgs.every((m) => m.origin === "sistema" && m.status === "simulada")).toBe(true);
    ai.key = undefined;
  }, 120_000);

  it("contato que não veio de anúncio não aciona o robô", async () => {
    const before = (await listAll(orgId, "videoAutopilotStates", { admin: true })).length;
    const envl: WaEnvelope[] = [{ phoneNumberId: null, displayPhone: null, field: "messages", events: [{ kind: "inbound", waMessageId: "wamid.X1", from: "5565911112222", profileName: "Fulano", text: "oi", timestamp: Math.floor(Date.now() / 1000), media: null }] }];
    await applyWhatsAppEvents(orgId, envl);
    await runAutopilot(envl, () => orgId, fetcher);
    expect((await listAll(orgId, "videoAutopilotStates", { admin: true })).length).toBe(before);
  });
});
