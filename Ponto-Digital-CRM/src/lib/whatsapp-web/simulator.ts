import "server-only";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AuthenticationCreds } from "baileys";
import type { WebSocketLike } from "./manager";

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

  /** Mensagem recebida (ou enviada pelo próprio celular, com fromMe). */
  message(input: { from: string; text: string; name?: string; fromMe?: boolean; group?: boolean }) {
    const remoteJid = input.group ? `1203630${input.from}@g.us` : `${input.from}@s.whatsapp.net`;
    this.ev.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: { remoteJid, fromMe: Boolean(input.fromMe), id: `SIM${Date.now()}${++this.seq}` },
          message: { conversation: input.text },
          messageTimestamp: Math.floor(Date.now() / 1000),
          pushName: input.name ?? null,
        },
      ],
    });
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
