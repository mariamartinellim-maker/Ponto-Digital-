import "server-only";
import { applyWhatsAppEvents } from "../data/repo";
import { getDb } from "../data/store";
import { env } from "../env";
import { hasSupabaseAdmin, supabaseAdmin } from "../supabase/admin";
import { isSupabase } from "../supabase/server";
import type { WaEvent } from "../whatsapp/events";
import { toDbEvent } from "../whatsapp/ingest";
import { loadAuthState, sessionKey, sessionStore, savedSessionOrg, type LoadedAuth } from "./auth-state";
import { saveAsset } from "../media/storage";
import { MAX_RECONNECTS, inList, linkedPhone, mediaSize, parseNumbers, reconnectDelay, toWaEvent, type WebMessage } from "./rules";

/**
 * Conexão EXPERIMENTAL pelo WhatsApp Web (QR Code), não oficial.
 *
 * Travas (todas no servidor):
 *  - desligada por padrão (WAWEB_HABILITADO=false);
 *  - só vincula os chips de teste de WAWEB_NUMEROS_PERMITIDOS: qualquer outro número é desvinculado na hora
 *    e a sessão apagada — protege o número principal;
 *  - só grava mensagens de contatos de teste (WAWEB_CONTATOS_TESTE); grupos e listas são ignorados;
 *  - SOMENTE RECEBE: este módulo não tem função de envio. Respostas pelo CRM seguem as travas da API oficial
 *    (simulação por padrão);
 *  - não baixa o histórico do aparelho e não aparece "online" para os contatos.
 * Uma conexão por servidor (uma organização), mantida na memória do processo do CRM.
 */

export type WebStatus = "desligado" | "iniciando" | "aguardando_qr" | "conectado" | "reconectando" | "bloqueado" | "erro";

export interface WebState {
  status: WebStatus;
  orgId: string | null;
  qr: string | null;
  phone: string | null;
  lastError: string | null;
  updatedAt: string;
  connectedAt: string | null;
  received: number;
  ignored: number;
  simulator: boolean;
}

/** O mínimo da conexão usado aqui (a biblioteca real e o simulador seguem este formato). */
export interface WebSocketLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cada evento tem seu formato (tratado nos ouvintes)
  ev: { on(event: string, listener: (arg: any) => void): unknown };
  user?: { id?: string; phoneNumber?: string };
  end(error?: Error): void;
  logout(): Promise<void>;
  /** Baixa o arquivo de uma mensagem com mídia (descriptografado pelo próprio WhatsApp Web). */
  downloadMedia?(msg: WebMessage): Promise<Uint8Array>;
}

interface Runtime {
  state: WebState;
  sock: WebSocketLike | null;
  auth: LoadedAuth | null;
  authOrg: string | null;
  attempts: number;
  timer: NodeJS.Timeout | null;
  /** Incrementado a cada nova conexão: eventos de conexões antigas são descartados. */
  generation: number;
}

const g = globalThis as unknown as { __waweb?: Runtime };
const rt = (): Runtime =>
  (g.__waweb ??= {
    state: {
      status: "desligado",
      orgId: null,
      qr: null,
      phone: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
      connectedAt: null,
      received: 0,
      ignored: 0,
      simulator: false,
    },
    sock: null,
    auth: null,
    authOrg: null,
    attempts: 0,
    timer: null,
    generation: 0,
  });

function set(patch: Partial<WebState>) {
  const r = rt();
  r.state = { ...r.state, ...patch, updatedAt: new Date().toISOString() };
}

export const wawebState = (): WebState => ({ ...rt().state });

/** Configuração e o que falta para ligar a conexão (sem expor valores). */
export function wawebConfig() {
  const e = env();
  const allowed = parseNumbers(e.WAWEB_NUMEROS_PERMITIDOS);
  const contacts = parseNumbers(e.WAWEB_CONTATOS_TESTE || e.WHATSAPP_NUMEROS_TESTE);
  const missing: string[] = [];
  if (!e.WAWEB_HABILITADO) missing.push("WAWEB_HABILITADO=true");
  if (!allowed.length) missing.push("WAWEB_NUMEROS_PERMITIDOS");
  if (!sessionKey()) missing.push("WAWEB_SESSION_KEY");
  if (isSupabase() && !hasSupabaseAdmin()) missing.push("SUPABASE_SECRET_KEY");
  return { enabled: e.WAWEB_HABILITADO, allowed, contacts, simulator: e.WAWEB_SIMULADOR, ready: missing.length === 0, missing };
}

async function createSocket(auth: LoadedAuth, simulator: boolean): Promise<WebSocketLike> {
  if (simulator) {
    const { SimulatedSocket } = await import("./simulator");
    return new SimulatedSocket(auth.state.creds);
  }
  const { default: makeWASocket, Browsers, makeCacheableSignalKeyStore, downloadMediaMessage } = await import("baileys");
  const logger = silentLogger();
  const sock = makeWASocket({
    auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) },
    browser: Browsers.ubuntu("Ponto Digital CRM (teste)"),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  });
  const wrapped = sock as unknown as WebSocketLike;
  wrapped.downloadMedia = async (msg) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- formato interno do Baileys (WAMessage)
    downloadMediaMessage(msg as any, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
  return wrapped;
}

function silentLogger() {
  const noop = () => {};
  const l = {
    level: "silent",
    child: () => l,
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: (obj: unknown, msg?: string) => console.error("[whatsapp-web]", msg ?? "", obj instanceof Error ? obj.message : ""),
  };
  return l;
}

async function ingest(orgId: string, events: WaEvent[]) {
  if (isSupabase()) {
    const rows = events.map(toDbEvent).filter((e): e is Record<string, unknown> => e !== null);
    const { error } = await supabaseAdmin().rpc("wa_ingest_batch", { p_org: orgId, p_events: rows });
    if (error) throw new Error(error.message);
    return;
  }
  await applyWhatsAppEvents(orgId, [{ phoneNumberId: null, displayPhone: null, field: "whatsapp_web", events }]);
}

async function connect(orgId: string) {
  const r = rt();
  const cfg = wawebConfig();
  const key = sessionKey()!;
  const gen = ++r.generation;
  // Reaproveita a sessão em memória (ex.: reinício pedido logo após a leitura do QR, antes da gravação).
  if (!r.auth || r.authOrg !== orgId) {
    r.auth = await loadAuthState(sessionStore(orgId), key, () => rt().state.phone);
    r.authOrg = orgId;
  }
  const auth = r.auth;
  set({ status: r.attempts ? "reconectando" : "iniciando", orgId, qr: null, simulator: cfg.simulator });
  const sock = await createSocket(auth, cfg.simulator);
  r.sock = sock;
  const live = () => rt().generation === gen;

  sock.ev.on("creds.update", () => auth.saveCreds());

  sock.ev.on("connection.update", async (u: { connection?: string; qr?: string; lastDisconnect?: { error?: { output?: { statusCode?: number } } } }) => {
    if (!live()) return;
    if (u.qr) set({ status: "aguardando_qr", qr: u.qr });
    if (u.connection === "open") {
      const phone = linkedPhone(sock.user);
      if (!inList(phone, wawebConfig().allowed)) {
        // Número fora da lista de teste (ex.: o número principal): desvincula e apaga tudo na hora.
        set({ status: "bloqueado", qr: null, phone: null, lastError: `O número lido no QR Code${phone ? ` (final ${phone.slice(-4)})` : ""} não está em WAWEB_NUMEROS_PERMITIDOS. Ele foi desvinculado e nenhuma mensagem foi lida.` });
        r.generation++; // ignora o fechamento que o logout provoca
        await sock.logout().catch(() => sock.end());
        await dropAuth(auth);
        r.sock = null;
        return;
      }
      r.attempts = 0;
      set({ status: "conectado", qr: null, phone, lastError: null, connectedAt: new Date().toISOString() });
      await auth.flush();
    }
    if (u.connection === "close") {
      r.sock = null;
      const code = u.lastDisconnect?.error?.output?.statusCode;
      const wasWaitingQr = rt().state.status === "aguardando_qr";
      if (code === 401) {
        await dropAuth(auth);
        set({ status: "desligado", qr: null, phone: null, lastError: "O aparelho foi desvinculado no celular. Para usar de novo, leia um novo QR Code." });
        return;
      }
      if (wasWaitingQr && code !== 515) {
        set({ status: "desligado", qr: null, lastError: "O QR Code expirou sem ser lido. Clique em Conectar para gerar outro." });
        return;
      }
      if (code === 515) {
        // A biblioteca pede reinício logo após a leitura do QR: reconecta na hora.
        void connect(orgId).catch(fail);
        return;
      }
      if (r.attempts >= MAX_RECONNECTS) {
        set({ status: "erro", qr: null, lastError: `Conexão perdida (código ${code ?? "?"}). Tentativas esgotadas; clique em Conectar.` });
        return;
      }
      r.attempts++;
      set({ status: "reconectando", qr: null, lastError: `Conexão perdida (código ${code ?? "?"}). Nova tentativa em ${reconnectDelay(r.attempts) / 1000} s.` });
      r.timer = setTimeout(() => void connect(orgId).catch(fail), reconnectDelay(r.attempts));
    }
  });

  sock.ev.on("messages.upsert", async (u: { type?: string; messages?: WebMessage[] }) => {
    if (!live() || u.type !== "notify" || rt().state.status !== "conectado") return;
    const contacts = wawebConfig().contacts;
    const events: WaEvent[] = [];
    let ignored = 0;
    for (const m of u.messages ?? []) {
      const res = toWaEvent(m, contacts);
      if ("event" in res) events.push(res.event);
      else ignored++;
    }
    if (ignored) set({ ignored: rt().state.ignored + ignored });
    if (!events.length) return;
    await saveIncomingMedia(orgId, sock, u.messages ?? [], events);
    try {
      await ingest(orgId, events);
      set({ received: rt().state.received + events.length });
    } catch (err) {
      console.error("[whatsapp-web] falha ao gravar mensagens:", (err as Error).message);
      set({ lastError: "Falha ao gravar mensagens recebidas. Veja os registros do servidor." });
    }
  });
}

const MAX_MEDIA = 50 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "video/mp4": "mp4", "application/pdf": "pdf" };

/**
 * Mídias recebidas (imagem, áudio, vídeo, PDF) vão para a biblioteca do CRM, ligadas à mensagem.
 * Figurinhas e arquivos acima de 50 MB ficam só como texto. Uma falha no download não impede gravar a mensagem.
 */
async function saveIncomingMedia(orgId: string, sock: WebSocketLike, msgs: WebMessage[], events: WaEvent[]) {
  if (!sock.downloadMedia) return;
  for (const ev of events) {
    if ((ev.kind !== "inbound" && ev.kind !== "echo") || !ev.media || ev.media.type === "sticker") continue;
    const msg = msgs.find((m) => `waweb.${m.key.id}`.slice(0, 120) === ev.waMessageId);
    if (!msg) continue;
    const declared = mediaSize(msg.message);
    if (declared && declared > MAX_MEDIA) continue;
    try {
      const bytes = await sock.downloadMedia(msg);
      const mime = (ev.media.mime ?? "").split(";")[0]!.trim().toLowerCase();
      const filename = ev.media.filename || `whatsapp-${String(msg.key.id).slice(0, 16)}.${EXT[mime] ?? "bin"}`;
      const asset = await saveAsset(
        { orgId, bytes, mime: ev.media.mime ?? "", filename, title: ev.media.caption || filename, tags: ["whatsapp"], source: "whatsapp_web", clientId: null, createdBy: null },
        { admin: true },
      );
      if ("error" in asset) console.warn("[whatsapp-web] mídia não guardada:", asset.error);
      else ev.media.assetId = asset.id;
    } catch (err) {
      console.warn("[whatsapp-web] falha ao baixar mídia:", (err as Error).message);
    }
  }
}

async function dropAuth(auth: LoadedAuth) {
  const r = rt();
  if (r.auth === auth) {
    r.auth = null;
    r.authOrg = null;
  }
  await auth.clear();
}

function fail(err: unknown) {
  console.error("[whatsapp-web]", (err as Error).message);
  set({ status: "erro", qr: null, lastError: (err as Error).message });
}

function closeCurrent() {
  const r = rt();
  if (r.timer) clearTimeout(r.timer);
  r.timer = null;
  r.generation++;
  r.sock?.end();
  r.sock = null;
}

/** Gera o QR Code (ou retoma a sessão salva) para a organização. */
export async function startWaWeb(orgId: string): Promise<{ error?: string }> {
  const cfg = wawebConfig();
  if (!cfg.ready) return { error: `Módulo experimental desligado. Falta configurar no servidor: ${cfg.missing.join(", ")}.` };
  const s = rt().state;
  if (s.orgId && s.orgId !== orgId && s.status !== "desligado") return { error: "Já existe uma conexão experimental de outra organização neste servidor." };
  if (["iniciando", "aguardando_qr", "conectado"].includes(s.status) && s.orgId === orgId) return {};
  closeCurrent();
  rt().attempts = 0;
  set({ lastError: null, received: 0, ignored: 0 });
  try {
    await connect(orgId);
    return {};
  } catch (err) {
    fail(err);
    return { error: "Não foi possível iniciar a conexão. Veja os registros do servidor." };
  }
}

/** Pausa a conexão mantendo a sessão (volta sem novo QR Code). */
export async function pauseWaWeb() {
  const r = rt();
  await r.auth?.flush();
  closeCurrent();
  set({ status: "desligado", qr: null, lastError: null });
}

/** Desvincula o aparelho e apaga a sessão salva. */
export async function logoutWaWeb(orgId: string) {
  const r = rt();
  const sock = r.sock;
  const auth = r.auth;
  closeCurrent();
  if (sock) await sock.logout().catch(() => {});
  if (auth) await dropAuth(auth);
  await sessionStore(orgId).clear();
  set({ status: "desligado", qr: null, phone: null, connectedAt: null, lastError: null });
}

/** Quando o servidor reinicia (ex.: deploy no Render), retoma a sessão salva sem pedir novo QR Code. */
export async function resumeWaWebOnBoot() {
  const cfg = wawebConfig();
  if (!cfg.ready) return;
  try {
    const orgId = isSupabase() ? await savedSessionOrg() : (await getDb()).organizations[0]?.id;
    if (!orgId) return;
    if (!(await sessionStore(orgId).load())) return;
    console.log("[whatsapp-web] retomando a sessão experimental salva");
    await startWaWeb(orgId);
  } catch (err) {
    console.error("[whatsapp-web] não foi possível retomar a sessão:", (err as Error).message);
  }
}
