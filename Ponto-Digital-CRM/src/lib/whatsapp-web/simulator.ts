import "server-only";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AuthenticationCreds } from "baileys";
import type { WebSocketLike } from "./manager";
import type { WebMessage } from "./rules";

export interface SimulatedMedia {
  type: "image" | "audio" | "video" | "document";
  mime: string;
  base64: string;
  filename?: string;
}

/**
 * Simulador da conexão do WhatsApp Web, para testes automatizados e demonstrações locais.
 * Nada sai do servidor: o "QR Code" é um texto aleatório e a leitura, as mensagens e as quedas
 * são acionadas pela rota /api/whatsapp-web/simulador (bloqueada na hospedagem).
 */
const g = globalThis as unknown as { __wawebSim?: SimulatedSocket | null };

export class SimulatedSocket implements WebSocketLike {
  ev = new EventEmitter();
  user?: { id?: string; phoneNumber?: string };
  private closed = false;
  private seq = 0;
  private files = new Map<string, Buffer>();

  constructor(private creds: AuthenticationCreds) {
    g.__wawebSim = this;
    setTimeout(() => {
      if (this.closed) return;
      this.ev.emit("connection.update", { connection: "connecting" });
      if (creds.registered && creds.me) {
        this.user = { id: creds.me.id };
        this.ev.emit("connection.update", { connection: "open" });
      } else {
        this.ev.emit("connection.update", { qr: `SIMULADOR-${randomBytes(16).toString("hex")}` });
      }
    }, 100);
  }

  /** Como se o celular tivesse lido o QR Code. */
  scan(phone: string) {
    const me = { id: `${phone}:7@s.whatsapp.net`, name: "Simulador" };
    this.creds.registered = true;
    this.creds.me = me;
    this.user = { id: me.id };
    this.ev.emit("creds.update", { registered: true, me });
    this.ev.emit("connection.update", { connection: "open", isNewLogin: true });
  }

  /** Mensagem recebida (ou enviada pelo próprio celular, com fromMe), com texto ou mídia. */
  message(input: { from: string; text: string; name?: string; fromMe?: boolean; group?: boolean; media?: SimulatedMedia }) {
    const remoteJid = input.group ? `1203630${input.from}@g.us` : `${input.from}@s.whatsapp.net`;
    const id = `SIM${Date.now()}${++this.seq}`;
    let message: Record<string, unknown> = { conversation: input.text };
    if (input.media) {
      const bytes = Buffer.from(input.media.base64, "base64");
      this.files.set(id, bytes);
      message = {
        [`${input.media.type}Message`]: {
          mimetype: input.media.mime,
          fileLength: String(bytes.byteLength),
          ...(input.media.filename ? { fileName: input.media.filename } : {}),
          ...(input.text && input.media.type !== "audio" ? { caption: input.text } : {}),
          ...(input.media.type === "audio" ? { ptt: true } : {}),
        },
      };
    }
    this.ev.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: { remoteJid, fromMe: Boolean(input.fromMe), id },
          message,
          messageTimestamp: Math.floor(Date.now() / 1000),
          pushName: input.name ?? null,
        },
      ],
    });
  }

  async downloadMedia(msg: WebMessage): Promise<Uint8Array> {
    const bytes = this.files.get(msg.key.id ?? "");
    if (!bytes) throw new Error("mídia simulada não encontrada");
    return bytes;
  }

  /** Queda da conexão com o código informado (408 = rede, 401 = desconectado no celular). */
  drop(statusCode: number) {
    this.closeWith(statusCode);
  }

  end() {
    this.closeWith(428);
  }

  async logout() {
    this.closeWith(401);
  }

  private closeWith(statusCode: number) {
    if (this.closed) return;
    this.closed = true;
    if (g.__wawebSim === this) g.__wawebSim = null;
    const error = Object.assign(new Error("simulador"), { output: { statusCode } });
    this.ev.emit("connection.update", { connection: "close", lastDisconnect: { error, date: new Date() } });
  }
}

export const currentSimulator = () => g.__wawebSim ?? null;
