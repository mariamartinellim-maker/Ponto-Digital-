import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import { getOne } from "@/lib/data/collections";
import { publicUser } from "@/lib/data/repo";
import { getDb, mutate } from "@/lib/data/store";
import type { VideoOrder } from "@/lib/data/types";
import { can } from "@/lib/permissions";
import { applyWatermark, ffmpegPath, finishVideo, photoToVideo } from "@/lib/video/ffmpeg";
import {
  allowedActions,
  animationPrompt,
  avatarPrompt,
  endCardLines,
  formatBrPhone,
  isStuck,
  monthStartCuiaba,
  paidRunsLeft,
  validateOrderInput,
} from "@/lib/video/rules";
import { cancelOrder, confirmPayment, createVideoOrder, sendStep, startGeneration, videoEngine } from "@/lib/video/service";

const order = (p: Partial<VideoOrder>): VideoOrder => ({
  id: "v1", orgId: "o", number: 1, clientId: "c", conversationId: null, modality: "taxi", driverName: "Benner Táxi", driverGender: "masculino", city: "Cuiabá",
  speech: "Precisando de táxi? Me chama!", contactPhone: "65999990000", adjustments: "", status: "foto_recebida", photoAssetId: "p", avatarAssetId: null,
  videoAssetId: null, previewAssetId: null, receiptAssetId: null, avatarRuns: 0, videoRuns: 0, engine: "simulador", autopilot: false, error: null, createdBy: null,
  createdAt: "2026-10-28T00:00:00.000Z", updatedAt: "2026-10-28T00:00:00.000Z", avatarSentAt: null, previewSentAt: null, paidAt: null, deliveredAt: null, ...p,
});

const probe = (file: Buffer) => {
  const out = execFileSync(ffmpegPath(), ["-hide_banner", "-i", "pipe:0", "-f", "null", "-"], { input: file, stdio: ["pipe", "pipe", "pipe"] }).toString();
  return out;
};
const duration = (file: Buffer) => {
  try {
    execFileSync(ffmpegPath(), ["-hide_banner", "-i", "pipe:0"], { input: file, stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String((e as { stderr?: Buffer }).stderr));
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return NaN;
};
// Foto de teste (JPEG 360x640) gerada pelo próprio FFmpeg.
const PHOTO = execFileSync(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=1", "-frames:v", "1", "-f", "mjpeg", "pipe:1"]);

describe("regras dos vídeos com avatar", () => {
  it("libera só as ações de cada etapa", () => {
    expect(allowedActions(order({}))).toEqual(["gerar_avatar", "cancelar"]);
    expect(allowedActions(order({ status: "avatar_pronto", avatarAssetId: "a" }))).toContain("enviar_avatar");
    expect(allowedActions(order({ status: "avatar_enviado", avatarAssetId: "a" }))).toEqual(expect.arrayContaining(["gerar_avatar", "gerar_video"]));
    expect(allowedActions(order({ status: "aguardando_pagamento" }))).toContain("confirmar_pagamento");
    expect(allowedActions(order({ status: "video_pronto" }))).not.toContain("confirmar_pagamento"); // pagamento só depois da prévia
    expect(allowedActions(order({ status: "pago" }))).toEqual(["enviar_final"]);
    expect(allowedActions(order({ status: "entregue" }))).toEqual([]);
    expect(allowedActions(order({ status: "gerando_video" }))).toEqual([]);
    expect(allowedActions(order({ status: "falhou", avatarAssetId: "a" }))).toEqual(["gerar_avatar", "gerar_video", "cancelar"]);
  });

  it("valida o pedido", () => {
    const ok = { driverName: "Benner Táxi", speech: "Me chama no WhatsApp!", contactPhone: "", modality: "taxi", driverGender: "masculino" };
    expect(validateOrderInput(ok)).toBeNull();
    expect(validateOrderInput({ ...ok, driverName: "  " })).toMatch(/nome/);
    expect(validateOrderInput({ ...ok, speech: Array(31).fill("palavra").join(" ") })).toMatch(/30 palavras/);
    expect(validateOrderInput({ ...ok, modality: "moto" })).toMatch(/segmento/);
    expect(validateOrderInput({ ...ok, modality: "mototaxi" })).toBeNull();
    expect(validateOrderInput({ ...ok, contactPhone: "123" })).toMatch(/inválido/);
  });

  it("monta os prompts oficiais: motorista à esquerda do carro e à direita da imagem; voz conforme o gênero", () => {
    const a = avatarPrompt(order({}));
    expect(a).toMatch(/banco do lado ESQUERDO/);
    expect(a).toMatch(/lado DIREITO da foto/);
    expect(a).toMatch(/Cuiabá/);
    expect(avatarPrompt(order({ driverGender: "feminino" }))).toMatch(/mulher da foto anexada como a motorista/);
    const v = animationPrompt(order({ driverGender: "feminino", speech: 'Oi "gente"\nchama!' }));
    expect(v).toMatch(/Voz FEMININA/);
    expect(v).toContain("Oi 'gente' chama!"); // fala sem quebras nem aspas duplas
    expect(animationPrompt(order({ adjustments: "sorriso maior" }))).toMatch(/AJUSTES PEDIDOS PELO CLIENTE: sorriso maior/);
  });

  it("formata telefone, encerramento, limite do mês e travamento", () => {
    expect(formatBrPhone("5565999990000")).toBe("(65) 99999-0000");
    expect(endCardLines(order({}))).toEqual({ title: "Benner Táxi", subtitle: "TÁXI", phone: "(65) 99999-0000" });
    expect(endCardLines(order({ modality: "mototaxi" })).subtitle).toBe("MOTOTÁXI");
  });

  it("adapta a cena ao segmento do motorista", () => {
    expect(avatarPrompt(order({ modality: "mototaxi" }))).toMatch(/pilotando a moto[\s\S]*capacete aberto[\s\S]*garupa/);
    expect(avatarPrompt(order({ modality: "mototaxi" }))).not.toMatch(/volante/);
    expect(animationPrompt(order({ modality: "motoboy" }))).not.toMatch(/passageiros/i);
    expect(avatarPrompt(order({ modality: "van" }))).toMatch(/van de passageiros/);
    expect(avatarPrompt(order({ modality: "executivo" }))).toMatch(/sedã preto/);
    expect(monthStartCuiaba(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-01T04:00:00.000Z"); // ainda 31/10 em Cuiabá
    expect(paidRunsLeft(18, 20)).toBe(2);
    expect(paidRunsLeft(25, 20)).toBe(0);
    expect(isStuck(order({ status: "gerando_video", updatedAt: new Date(Date.now() - 20 * 60_000).toISOString() }))).toBe(true);
    expect(isStuck(order({ status: "gerando_video", updatedAt: new Date().toISOString() }))).toBe(false);
  });

  it("todos os perfis usam a tela de vídeos", () => {
    expect(can("atendente", "videos:manage")).toBe(true);
    expect(can("gestor", "videos:manage")).toBe(true);
  });
});

describe("FFmpeg: acabamento, marca d'água e simulador", () => {
  it("gera vídeo vertical de 10 s com marca d'água", async () => {
    const sim = await photoToVideo(PHOTO, "image/jpeg");
    expect(duration(sim)).toBeCloseTo(8, 0);
    const final = await finishVideo(sim, endCardLines(order({})));
    expect(duration(final)).toBeCloseTo(10, 0);
    const preview = await applyWatermark(final);
    expect(probe(preview)).toBeDefined();
    expect(preview.subarray(4, 8).toString()).toBe("ftyp");
    expect(Buffer.compare(preview, final)).not.toBe(0);
  }, 120_000);
});

describe("fluxo do pedido de vídeo (base em memória, simulador)", () => {
  let gestor: SessionUser, atendente: SessionUser, clientId: string;
  const as = async (role: string) => {
    const u = (await getDb()).users.find((x) => x.role === role)!;
    return { ...publicUser(u), orgName: "Ponto Digital" } as SessionUser;
  };
  const waitFor = async (id: string, status: VideoOrder["status"]) => {
    for (let i = 0; i < 120; i++) {
      const o = await getOne(gestor.orgId, "videoOrders", id);
      if (o?.status === status) return o;
      if (o?.status === "falhou") throw new Error(o.error ?? "falhou");
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`não chegou em ${status}`);
  };
  beforeAll(async () => {
    [gestor, atendente] = await Promise.all([as("gestor"), as("atendente")]);
    const db = await getDb();
    const conv = db.conversations.find((c) => c.orgId === gestor.orgId)!;
    clientId = conv.clientId;
    // Cliente escreveu agora: janela de 24h aberta e conversa da atendente.
    await mutate((d) => {
      const c = d.conversations.find((x) => x.id === conv.id)!;
      c.lastInboundAt = new Date().toISOString();
      c.assigneeId = atendente.id;
    });
  });
  afterAll(async () => {
    await rm(path.join(process.cwd(), ".data", "arquivos", gestor.orgId), { recursive: true, force: true });
  });

  it("foto → avatar → aprovação → vídeo → prévia → pagamento → vídeo final", async () => {
    expect(videoEngine()).toBe("simulador"); // sem VIDEO_AUTOMACAO e sem chaves: nenhuma IA paga
    const c = await createVideoOrder(atendente, { clientId, modality: "taxi", driverGender: "masculino", driverName: "Benner Táxi", city: "", speech: "Precisando de táxi? Me chama!", contactPhone: "", photo: { bytes: PHOTO, mime: "image/jpeg", filename: "rosto.jpg" } });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const client = (await getDb()).clients.find((x) => x.id === clientId)!;
    expect(c.value).toMatchObject({ status: "foto_recebida", engine: "simulador", contactPhone: client.phone });
    expect(c.value.conversationId).not.toBeNull();

    expect((await sendStep(atendente, c.value.id, "enviar_previa")).ok).toBe(false); // fora de ordem
    expect((await startGeneration(atendente, c.value.id, "gerar_avatar", "")).ok).toBe(true);
    const a = await waitFor(c.value.id, "avatar_pronto");
    expect(a.avatarAssetId).not.toBeNull();
    expect((await getOne(gestor.orgId, "mediaAssets", a.avatarAssetId!))?.mime).toBe("image/jpeg");

    const sent = await sendStep(atendente, c.value.id, "enviar_avatar");
    expect(sent).toEqual({ ok: true, value: { simulated: true } }); // testes nunca enviam de verdade
    expect((await startGeneration(atendente, c.value.id, "gerar_video", "")).ok).toBe(true);
    const v = await waitFor(c.value.id, "video_pronto");
    expect(v.videoAssetId && v.previewAssetId).toBeTruthy();
    expect(v.videoAssetId).not.toBe(v.previewAssetId);

    expect((await confirmPayment(gestor, c.value.id)).ok).toBe(false); // antes da prévia, não
    expect((await sendStep(atendente, c.value.id, "enviar_previa")).ok).toBe(true);
    expect((await sendStep(atendente, c.value.id, "enviar_final")).ok).toBe(false); // sem pagamento, não
    expect((await confirmPayment(atendente, c.value.id)).ok).toBe(true);
    expect((await sendStep(atendente, c.value.id, "enviar_final")).ok).toBe(true);
    const done = await getOne(gestor.orgId, "videoOrders", c.value.id);
    expect(done).toMatchObject({ status: "entregue", avatarRuns: 1, videoRuns: 1 });

    const msgs = (await getDb()).messages.filter((m) => m.conversationId === c.value.conversationId && m.media?.assetId);
    expect(msgs.map((m) => m.media!.assetId)).toEqual(expect.arrayContaining([a.avatarAssetId, v.previewAssetId, v.videoAssetId]));
    expect(msgs.every((m) => m.status === "simulada")).toBe(true);
  }, 120_000);

  it("limita refações e só gestor/admin cancela", async () => {
    const c = await createVideoOrder(atendente, { clientId, modality: "uber", driverGender: "feminino", driverName: "Motorista RJ", city: "Rio", speech: "Corridas com conforto!", contactPhone: "21988887777", photo: { bytes: PHOTO, mime: "image/jpeg", filename: "f.jpg" } });
    if (!c.ok) throw new Error(c.error);
    for (let i = 0; i < 3; i++) {
      expect((await startGeneration(atendente, c.value.id, "gerar_avatar", i ? "cabelo mais curto" : "")).ok).toBe(true);
      await waitFor(c.value.id, "avatar_pronto");
    }
    const fourth = await startGeneration(atendente, c.value.id, "gerar_avatar", "");
    expect(fourth.ok ? "" : fourth.error).toMatch(/Limite de 3/);
    expect((await getOne(gestor.orgId, "videoOrders", c.value.id))?.adjustments).toBe("cabelo mais curto");
    expect((await cancelOrder(atendente, c.value.id)).ok).toBe(false);
    expect((await cancelOrder(gestor, c.value.id)).ok).toBe(true);
  }, 60_000);
});
