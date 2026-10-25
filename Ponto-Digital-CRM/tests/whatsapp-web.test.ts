import { readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/data/store";
import { loadAuthState, type SessionStore } from "@/lib/whatsapp-web/auth-state";
import { logoutWaWeb, pauseWaWeb, startWaWeb, wawebConfig, wawebState } from "@/lib/whatsapp-web/manager";
import { extractContent, jidPhone, linkedPhone, parseNumbers, reconnectDelay, toWaEvent } from "@/lib/whatsapp-web/rules";
import { currentSimulator } from "@/lib/whatsapp-web/simulator";

// Configuração do módulo experimental para este arquivo (env() é lido sob demanda).
const CHIP = "5511977770001"; // chip de teste autorizado
const PRINCIPAL = "5511955550000"; // "número principal": nunca pode ser vinculado
const CONTATO = "5511966660001"; // contato de teste
Object.assign(process.env, {
  WAWEB_HABILITADO: "true",
  WAWEB_SIMULADOR: "true",
  WAWEB_NUMEROS_PERMITIDOS: CHIP,
  WAWEB_CONTATOS_TESTE: `${CONTATO}, 5511966660002`,
});

const KEY = Buffer.alloc(32, 7).toString("base64");
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("tempo esgotado");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("regras do WhatsApp Web experimental", () => {
  it("lê listas de números e telefones de JIDs", () => {
    expect(parseNumbers("5511977770001; (11) 96666-0001 , 123")).toEqual(["5511977770001", "5511966660001"]);
    expect(jidPhone("5511977770001:12@s.whatsapp.net")).toBe("5511977770001");
    expect(jidPhone("123456789@lid")).toBeNull();
    expect(jidPhone("120363000@g.us")).toBeNull();
    expect(linkedPhone({ id: "999@lid", phoneNumber: "5511977770001@s.whatsapp.net" })).toBe("5511977770001");
  });

  it("converte mensagens de contatos de teste no formato do webhook oficial", () => {
    const r = toWaEvent({ key: { remoteJid: `${CONTATO}@s.whatsapp.net`, id: "ABC" }, message: { conversation: "Oi" }, messageTimestamp: 1761400000, pushName: "Teste" }, [CONTATO]);
    expect(r).toEqual({ event: { kind: "inbound", waMessageId: "waweb.ABC", from: CONTATO, profileName: "Teste", text: "Oi", timestamp: 1761400000, media: null } });
    // Conta com LID: o telefone vem em remoteJidAlt
    const lid = toWaEvent({ key: { remoteJid: "777@lid", remoteJidAlt: `${CONTATO}@s.whatsapp.net`, id: "L1" }, message: { conversation: "x" } }, [CONTATO]);
    expect("event" in lid && lid.event.kind).toBe("inbound");
    // Enviada pelo próprio celular → eco (origem: app)
    const echo = toWaEvent({ key: { remoteJid: `${CONTATO}@s.whatsapp.net`, id: "E1", fromMe: true }, message: { conversation: "resposta do celular" } }, [CONTATO]);
    expect("event" in echo && echo.event.kind).toBe("echo");
  });

  it("ignora grupos, listas, contatos fora do teste, LID sem telefone e mensagens de protocolo", () => {
    const base = { id: "X" };
    expect(toWaEvent({ key: { ...base, remoteJid: "120363@g.us" }, message: { conversation: "a" } }, [CONTATO])).toEqual({ ignored: "grupo_ou_lista" });
    expect(toWaEvent({ key: { ...base, remoteJid: "status@broadcast" }, message: { conversation: "a" } }, [CONTATO])).toEqual({ ignored: "grupo_ou_lista" });
    expect(toWaEvent({ key: { ...base, remoteJid: "5511900001111@s.whatsapp.net" }, message: { conversation: "a" } }, [CONTATO])).toEqual({ ignored: "contato_fora_do_teste" });
    expect(toWaEvent({ key: { ...base, remoteJid: "777@lid" }, message: { conversation: "a" } }, [CONTATO])).toEqual({ ignored: "sem_numero" });
    expect(toWaEvent({ key: { ...base, remoteJid: `${CONTATO}@s.whatsapp.net` }, message: { protocolMessage: { type: 0 } } }, [CONTATO])).toEqual({ ignored: "sem_conteudo" });
  });

  it("descreve mídias (com legenda) e abre mensagens temporárias", () => {
    expect(extractContent({ imageMessage: { mimetype: "image/jpeg", caption: "comprovante" } })).toEqual({ text: "[imagem] comprovante", media: { type: "image", mime: "image/jpeg", caption: "comprovante" } });
    expect(extractContent({ audioMessage: { mimetype: "audio/ogg", ptt: true } })?.media).toMatchObject({ type: "audio", voice: true });
    expect(extractContent({ ephemeralMessage: { message: { extendedTextMessage: { text: "some em 24h" } } } })?.text).toBe("some em 24h");
    expect(extractContent({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "nota.pdf" } } } })?.text).toBe("[documento] nota.pdf");
  });

  it("espaça as reconexões até 60 s", () => {
    expect([1, 2, 3, 10].map(reconnectDelay)).toEqual([2000, 4000, 8000, 60000]);
  });

  it("o módulo não tem nenhuma função de envio de mensagens", () => {
    const dir = path.resolve(__dirname, "../src/lib/whatsapp-web");
    for (const f of readdirSync(dir)) expect(readFileSync(path.join(dir, f), "utf8")).not.toMatch(/sendMessage|relayMessage/);
  });
});

describe("sessão criptografada", () => {
  it("grava só o bloco criptografado e recupera as credenciais e chaves", async () => {
    let saved: string | null = null;
    const store: SessionStore = { load: async () => saved, save: async (b) => void (saved = b), clear: async () => void (saved = null) };
    const a = await loadAuthState(store, KEY, () => CHIP);
    expect(a.registered).toBe(false);
    a.state.creds.registered = true;
    await a.state.keys.set({ "pre-key": { "1": { public: Buffer.from("pub"), private: Buffer.from("priv") } } });
    await a.flush();
    expect(saved).toMatch(/^v1\./);
    expect(saved).not.toContain("priv");
    const b = await loadAuthState(store, KEY, () => CHIP);
    expect(b.registered).toBe(true);
    const keys = await b.state.keys.get("pre-key", ["1", "2"]);
    expect(Buffer.from(keys["1"]!.private).toString()).toBe("priv");
    expect(keys["2"]).toBeUndefined();
    // Com outra chave, a sessão é ilegível: começa do zero (novo QR) em vez de quebrar
    const c = await loadAuthState(store, Buffer.alloc(32, 9).toString("base64"), () => CHIP);
    expect(c.state.creds.registered).toBeFalsy();
    // Depois de apagada, nenhuma gravação atrasada recria a sessão
    await b.clear();
    await b.state.keys.set({ "pre-key": { "3": { public: Buffer.from("a"), private: Buffer.from("b") } } });
    await new Promise((r) => setTimeout(r, 900));
    expect(saved).toBeNull();
  });
});

describe("conexão com o simulador (modo demonstração)", () => {
  afterAll(async () => {
    const db = await getDb();
    await logoutWaWeb(db.organizations[0]!.id);
  });

  it("exige a configuração completa", () => {
    expect(wawebConfig()).toMatchObject({ enabled: true, ready: true, simulator: true, missing: [] });
  });

  it("desvincula na hora um número fora da lista (ex.: o principal)", async () => {
    const orgId = (await getDb()).organizations[0]!.id;
    expect(await startWaWeb(orgId)).toEqual({});
    await waitFor(() => wawebState().status === "aguardando_qr");
    expect(wawebState().qr).toMatch(/^SIMULADOR-/);
    currentSimulator()!.scan(PRINCIPAL);
    await waitFor(() => wawebState().status === "bloqueado");
    expect(wawebState().phone).toBeNull();
    expect(wawebState().lastError).toContain("final 0000");
    expect(currentSimulator()).toBeNull(); // conexão encerrada
  });

  it("vincula o chip de teste e grava só mensagens dos contatos de teste", async () => {
    const db = await getDb();
    const orgId = db.organizations[0]!.id;
    await startWaWeb(orgId);
    await waitFor(() => wawebState().status === "aguardando_qr");
    currentSimulator()!.scan(CHIP);
    await waitFor(() => wawebState().status === "conectado");
    expect(wawebState().phone).toBe(CHIP);

    const before = db.messages.length;
    currentSimulator()!.message({ from: CONTATO, text: "Olá, quero um orçamento", name: "Contato Teste" });
    currentSimulator()!.message({ from: "5511900001111", text: "não é de teste" });
    currentSimulator()!.message({ from: CONTATO, text: "grupo", group: true });
    await waitFor(() => wawebState().received === 1 && wawebState().ignored === 2);
    expect(db.messages.length).toBe(before + 1);
    const msg = db.messages.find((m) => m.body === "Olá, quero um orçamento")!;
    expect(msg).toMatchObject({ direction: "in", origin: "cliente", status: "recebida" });
    expect(msg.waMessageId).toMatch(/^waweb\./);
    const client = db.clients.find((c) => c.phone === CONTATO)!;
    expect(client.name).toBe("Contato Teste");
    expect(db.clients.some((c) => c.phone === "5511900001111")).toBe(false);
  });

  it("guarda imagens e áudios recebidos na biblioteca, ligados à mensagem", async () => {
    const db = await getDb();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const received = wawebState().received;
    currentSimulator()!.message({ from: CONTATO, text: "Segue o comprovante", media: { type: "image", mime: "image/jpeg", base64: png } });
    currentSimulator()!.message({ from: CONTATO, text: "", media: { type: "image", mime: "image/png", base64: Buffer.from("<html>").toString("base64") } });
    await waitFor(() => wawebState().received === received + 2);
    const msg = db.messages.find((m) => m.body === "[imagem] Segue o comprovante")!;
    expect(msg.media).toMatchObject({ type: "image", caption: "Segue o comprovante" });
    const asset = db.mediaAssets.find((a) => a.id === msg.media!.assetId)!;
    expect(asset).toMatchObject({ source: "whatsapp_web", type: "image", tags: ["whatsapp"] });
    // Conteúdo que não é imagem de verdade: a mensagem fica, o arquivo não entra na biblioteca.
    const fake = db.messages.filter((m) => m.waMessageId?.startsWith("waweb.") && m.body === "[imagem]").at(-1)!;
    expect(fake.media?.assetId).toBeUndefined();
    await rm(path.join(process.cwd(), ".data", "arquivos", asset.orgId), { recursive: true, force: true });
  });

  it("pausa e retoma sem novo QR Code; reconecta após queda de rede", async () => {
    const orgId = (await getDb()).organizations[0]!.id;
    await pauseWaWeb();
    expect(wawebState().status).toBe("desligado");
    await startWaWeb(orgId);
    await waitFor(() => wawebState().status === "conectado");
    currentSimulator()!.drop(408);
    await waitFor(() => wawebState().status === "reconectando");
    await waitFor(() => wawebState().status === "conectado", 5000);
  });

  it("desvinculado no celular: apaga a sessão e exige novo QR Code", async () => {
    const orgId = (await getDb()).organizations[0]!.id;
    currentSimulator()!.drop(401);
    await waitFor(() => wawebState().status === "desligado");
    expect(wawebState().lastError).toContain("desvinculado");
    await startWaWeb(orgId);
    await waitFor(() => wawebState().status === "aguardando_qr");
  });
});
