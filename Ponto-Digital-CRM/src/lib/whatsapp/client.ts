import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "../env";

export type SendResult =
  | { ok: true; simulated: boolean; waMessageId: string }
  | { ok: false; error: string };

type SendPayload =
  | { type: "text"; to: string; body: string }
  | { type: "template"; to: string; name: string; language: string; variables: string[] };

/**
 * Cliente da WhatsApp Cloud API oficial (graph.facebook.com).
 *
 * Proteções:
 *  - Por padrão (WHATSAPP_SEND_MODE=simulacao) NADA é enviado: a mensagem é apenas registrada.
 *  - Campanhas exigem, além do modo "live", WHATSAPP_CAMPAIGNS_LIVE=true.
 *  - Em testes automatizados (NODE_ENV=test) o envio real é sempre bloqueado.
 */
export async function sendWhatsApp(payload: SendPayload, opts: { campaign?: boolean } = {}): Promise<SendResult> {
  const e = env();
  const live =
    e.WHATSAPP_SEND_MODE === "live" && e.NODE_ENV !== "test" && (!opts.campaign || e.WHATSAPP_CAMPAIGNS_LIVE);

  if (!live) {
    return { ok: true, simulated: true, waMessageId: `wamid.SIMULADO.${randomUUID()}` };
  }
  if (!e.WHATSAPP_ACCESS_TOKEN || !e.WHATSAPP_PHONE_NUMBER_ID) {
    return { ok: false, error: "Credenciais da Cloud API não configuradas." };
  }

  const body =
    payload.type === "text"
      ? { messaging_product: "whatsapp", to: payload.to, type: "text", text: { body: payload.body, preview_url: false } }
      : {
          messaging_product: "whatsapp",
          to: payload.to,
          type: "template",
          template: {
            name: payload.name,
            language: { code: payload.language },
            components: payload.variables.length
              ? [{ type: "body", parameters: payload.variables.map((text) => ({ type: "text", text })) }]
              : [],
          },
        };

  const res = await fetch(`https://graph.facebook.com/${e.WHATSAPP_GRAPH_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok || !json.messages?.[0]?.id) {
    return { ok: false, error: json.error?.message ?? `Erro HTTP ${res.status}` };
  }
  return { ok: true, simulated: false, waMessageId: json.messages[0].id };
}
