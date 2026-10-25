import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { env } from "../env";
import { buildSystemPrompt, buildTranscript, SuggestionSchema, type Knowledge, type Suggestion, type TranscriptMessage } from "./prompt";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 }));

export type SuggestResult =
  | { ok: true; suggestion: Suggestion; model: string; usage: { input: number; output: number; cacheRead: number } }
  | { ok: false; error: string };

/**
 * Gera uma sugestão de resposta (nível 1: o humano revisa e envia).
 * - Base de conhecimento no prompt de sistema com cache (custo menor a partir da 2ª sugestão).
 * - Saída estruturada validada (resposta + "precisa de humano" + motivo + intenção + etapa).
 * - Se o modelo recusar por segurança, a API tenta um modelo reserva automaticamente.
 */
export async function suggestReply(input: {
  orgName: string;
  knowledge: Knowledge;
  clientFirstName: string;
  messages: TranscriptMessage[];
}): Promise<SuggestResult> {
  const e = env();
  if (!e.ANTHROPIC_API_KEY) return { ok: false, error: "IA não configurada (ANTHROPIC_API_KEY)." };
  try {
    const response = await anthropic().beta.messages.parse({
      model: e.AI_MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: e.AI_ESFORCO, format: betaZodOutputFormat(SuggestionSchema) },
      system: [{ type: "text", text: buildSystemPrompt(input.orgName, input.knowledge), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildTranscript(input.clientFirstName, input.messages) }],
    });
    if (response.stop_reason === "refusal") return { ok: false, error: "A IA não pôde sugerir uma resposta para esta conversa. Responda manualmente." };
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return { ok: false, error: "A IA não concluiu a sugestão. Tente novamente." };
    }
    const s = response.parsed_output;
    return {
      ok: true,
      suggestion: { ...s, resposta: s.resposta.trim().slice(0, 4096), motivo: s.motivo.trim().slice(0, 500) },
      model: response.model,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
      },
    };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error("[ia] chave da Anthropic recusada");
      return { ok: false, error: "A chave da IA foi recusada. Avise o administrador." };
    }
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: "Muitas sugestões ao mesmo tempo. Aguarde alguns segundos." };
    if (err instanceof Anthropic.BadRequestError) {
      console.error("[ia] requisição recusada:", err.message);
      return { ok: false, error: "A IA recusou a requisição. Avise o administrador." };
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[ia] erro da API:", err.status);
      return { ok: false, error: "A IA está indisponível no momento. Tente novamente." };
    }
    console.error("[ia] falha de conexão");
    return { ok: false, error: "Não foi possível falar com a IA. Tente novamente." };
  }
}
