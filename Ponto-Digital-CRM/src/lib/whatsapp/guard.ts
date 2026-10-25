import { phoneDedupKey } from "../phone";

export interface SendConfig {
  sendMode: "simulacao" | "live";
  environment: "teste" | "producao";
  testNumbers: string[];
  campaignsLive: boolean;
  nodeEnv: string;
}

export type SendDecision = { mode: "simulate" } | { mode: "live" } | { mode: "blocked"; reason: string };

/**
 * Decide se uma mensagem sai de verdade para o WhatsApp. Ordem das travas:
 *  1. testes automatizados nunca enviam;
 *  2. WHATSAPP_SEND_MODE=simulacao → só registra no CRM;
 *  3. campanhas exigem também WHATSAPP_CAMPAIGNS_LIVE=true (senão, simuladas);
 *  4. no ambiente "teste", envio real só para os números de teste; os demais são recusados.
 */
export function decideSend(cfg: SendConfig, to: string, opts: { campaign?: boolean } = {}): SendDecision {
  if (cfg.nodeEnv === "test" || cfg.sendMode !== "live") return { mode: "simulate" };
  if (opts.campaign && !cfg.campaignsLive) return { mode: "simulate" };
  if (cfg.environment === "teste") {
    const key = phoneDedupKey(to.replace(/\D/g, ""));
    if (!cfg.testNumbers.some((n) => phoneDedupKey(n) === key)) {
      return {
        mode: "blocked",
        reason: "Ambiente de teste: o envio real só é permitido para os números de teste da equipe. Nada foi enviado.",
      };
    }
  }
  return { mode: "live" };
}

/** Tipos e limites de arquivo aceitos pela Cloud API (com teto de 16 MB no CRM). */
export const MEDIA_RULES = {
  image: { mimes: ["image/jpeg", "image/png"], max: 5 * 1024 * 1024 },
  audio: { mimes: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"], max: 16 * 1024 * 1024 },
  video: { mimes: ["video/mp4", "video/3gpp"], max: 16 * 1024 * 1024 },
  document: {
    mimes: [
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    max: 16 * 1024 * 1024,
  },
} as const;
export type OutgoingMediaType = keyof typeof MEDIA_RULES;

export function classifyMedia(mime: string, size: number): { type: OutgoingMediaType } | { error: string } {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  for (const [type, rule] of Object.entries(MEDIA_RULES) as [OutgoingMediaType, (typeof MEDIA_RULES)[OutgoingMediaType]][]) {
    if ((rule.mimes as readonly string[]).includes(base)) {
      if (size > rule.max) return { error: `Arquivo muito grande para ${type === "image" ? "imagem" : "este tipo"} (máx. ${rule.max / 1024 / 1024} MB).` };
      if (size === 0) return { error: "Arquivo vazio." };
      return { type };
    }
  }
  return { error: "Tipo de arquivo não aceito pelo WhatsApp (use JPG, PNG, PDF, Word, Excel, PowerPoint, MP3, OGG, MP4)." };
}
