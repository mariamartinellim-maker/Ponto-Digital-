import "server-only";
import { randomUUID } from "node:crypto";
import { env, testNumbers } from "../env";
import { hasSupabaseAdmin, supabaseAdmin } from "../supabase/admin";
import { decryptSecret } from "./crypto";
import { graph, GraphError } from "./graph";
import { decideSend, type OutgoingMediaType } from "./guard";

export type SendResult =
  | { ok: true; simulated: boolean; waMessageId: string }
  | { ok: false; error: string };

type SendPayload =
  | { type: "text"; to: string; body: string }
  | { type: "template"; to: string; name: string; language: string; variables: string[] }
  | { type: "media"; to: string; media: OutgoingMediaType; mediaId: string; caption?: string; filename?: string };

export interface WaCredentials {
  token: string;
  phoneNumberId: string;
  wabaId: string | null;
  source: "variaveis" | "conexao";
}

/**
 * Credenciais da Cloud API: as variáveis do servidor (token de usuário do sistema) ou, se ausentes,
 * a conta conectada pelo Embedded Signup (token criptografado no banco, aberto só aqui).
 */
export async function waCredentials(orgId?: string): Promise<WaCredentials | null> {
  const e = env();
  if (e.WHATSAPP_ACCESS_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID) {
    return { token: e.WHATSAPP_ACCESS_TOKEN, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID, wabaId: e.WHATSAPP_WABA_ID ?? null, source: "variaveis" };
  }
  if (!orgId || !hasSupabaseAdmin() || !e.WHATSAPP_TOKEN_KEY) return null;
  const { data } = await supabaseAdmin()
    .from("whatsapp_accounts")
    .select("phone_number_id,waba_id,token_ciphertext")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data?.token_ciphertext) return null;
  try {
    return {
      token: decryptSecret(String(data.token_ciphertext), e.WHATSAPP_TOKEN_KEY),
      phoneNumberId: String(data.phone_number_id),
      wabaId: data.waba_id ? String(data.waba_id) : null,
      source: "conexao",
    };
  } catch {
    console.error("[whatsapp] não foi possível abrir o token salvo (WHATSAPP_TOKEN_KEY mudou?)");
    return null;
  }
}

export function sendDecision(to: string, opts: { campaign?: boolean } = {}) {
  const e = env();
  return decideSend(
    { sendMode: e.WHATSAPP_SEND_MODE, environment: e.WHATSAPP_AMBIENTE, testNumbers: testNumbers(), campaignsLive: e.WHATSAPP_CAMPAIGNS_LIVE, nodeEnv: e.NODE_ENV },
    to,
    opts,
  );
}

/**
 * Envia pela WhatsApp Cloud API oficial (graph.facebook.com).
 *
 * Proteções (ver guard.ts): simulação por padrão; ambiente de teste restrito aos números da
 * equipe; campanhas reais só com WHATSAPP_CAMPAIGNS_LIVE=true; testes automatizados nunca enviam.
 */
export async function sendWhatsApp(payload: SendPayload, opts: { campaign?: boolean; orgId?: string } = {}): Promise<SendResult> {
  const decision = sendDecision(payload.to, opts);
  if (decision.mode === "simulate") return { ok: true, simulated: true, waMessageId: `wamid.SIMULADO.${randomUUID()}` };
  if (decision.mode === "blocked") return { ok: false, error: decision.reason };

  const creds = await waCredentials(opts.orgId);
  if (!creds) return { ok: false, error: "Credenciais da Cloud API não configuradas." };

  const body: Record<string, unknown> = { messaging_product: "whatsapp", recipient_type: "individual", to: payload.to };
  if (payload.type === "text") {
    Object.assign(body, { type: "text", text: { body: payload.body, preview_url: false } });
  } else if (payload.type === "template") {
    Object.assign(body, {
      type: "template",
      template: {
        name: payload.name,
        language: { code: payload.language },
        components: payload.variables.length
          ? [{ type: "body", parameters: payload.variables.map((text) => ({ type: "text", text })) }]
          : [],
      },
    });
  } else {
    const media: Record<string, string> = { id: payload.mediaId };
    if (payload.caption && payload.media !== "audio") media.caption = payload.caption;
    if (payload.media === "document" && payload.filename) media.filename = payload.filename;
    Object.assign(body, { type: payload.media, [payload.media]: media });
  }

  try {
    const json = await graph<{ messages?: { id: string }[] }>(`${creds.phoneNumberId}/messages`, creds.token, { json: body, timeoutMs: 15_000 });
    const id = json.messages?.[0]?.id;
    return id ? { ok: true, simulated: false, waMessageId: id } : { ok: false, error: "Resposta inesperada da API da Meta." };
  } catch (err) {
    if (err instanceof GraphError) {
      // 131047: fora da janela de 24h; 131026: número sem WhatsApp; 130429/131056: limite de envio
      return { ok: false, error: err.message };
    }
    return { ok: false, error: "Não foi possível falar com a API da Meta. Tente novamente." };
  }
}
