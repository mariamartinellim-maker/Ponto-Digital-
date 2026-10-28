import "server-only";
import { env } from "../env";

/**
 * APIs pagas dos vídeos: avatar (imagem, OpenAI) e animação (vídeo, Veo pelo Google AI Studio).
 * As chaves ficam só nas variáveis do servidor. Mensagens de erro nunca incluem a chave.
 */
export class ProviderError extends Error {}

const OPENAI = "https://api.openai.com/v1/images/edits";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

export const providersConfigured = () => {
  const e = env();
  return { avatar: Boolean(e.OPENAI_API_KEY), video: Boolean(e.GOOGLE_AI_API_KEY) };
};

/** Avatar a partir da foto do cliente, mantendo o rosto (OpenAI Images, edição com imagem de referência). */
export async function generateAvatar(photo: Uint8Array, mime: string, prompt: string): Promise<{ bytes: Buffer; mime: string }> {
  const e = env();
  if (!e.OPENAI_API_KEY) throw new ProviderError("Chave da OpenAI não configurada.");
  const form = new FormData();
  form.set("model", e.OPENAI_IMAGE_MODEL);
  form.set("prompt", prompt);
  form.set("size", "1024x1536"); // vertical (2:3), o mais próximo de 9:16; o FFmpeg recorta para 720x1280
  form.set("quality", "high");
  form.set("input_fidelity", "high"); // preserva o rosto da foto de referência
  form.set("n", "1");
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  form.set("image", new Blob([Buffer.from(photo)], { type: mime }), `foto.${ext}`);
  const res = await fetch(OPENAI, { method: "POST", headers: { Authorization: `Bearer ${e.OPENAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(240_000) });
  const body = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string; code?: string } };
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new ProviderError("A OpenAI recusou a chave. Confira OPENAI_API_KEY no Render.");
    if (res.status === 429) throw new ProviderError("OpenAI sem saldo ou ocupada. Confira o crédito da conta e tente de novo.");
    if (body.error?.code === "moderation_blocked") throw new ProviderError("A OpenAI recusou esta foto pelas regras de segurança. Peça outra foto ao cliente.");
    throw new ProviderError(`OpenAI: ${(body.error?.message ?? `HTTP ${res.status}`).slice(0, 200)}`);
  }
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new ProviderError("A OpenAI não devolveu a imagem.");
  return { bytes: Buffer.from(b64, "base64"), mime: "image/png" };
}

type VeoOperation = {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Vídeo de 8 s (o máximo do Veo por geração) a partir do avatar, com fala em português gerada pelo próprio Veo.
 * A geração é assíncrona: pede, acompanha a cada 10 s (até 10 min) e baixa o arquivo.
 */
export async function generateVideo(image: Uint8Array, mime: string, prompt: string): Promise<Buffer> {
  const e = env();
  if (!e.GOOGLE_AI_API_KEY) throw new ProviderError("Chave do Google AI Studio não configurada.");
  const headers = { "x-goog-api-key": e.GOOGLE_AI_API_KEY, "Content-Type": "application/json" };
  const start = await fetch(`${GEMINI}/models/${e.VIDEO_VEO_MODELO}:predictLongRunning`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      instances: [{ prompt, image: { bytesBase64Encoded: Buffer.from(image).toString("base64"), mimeType: mime } }],
      parameters: { aspectRatio: "9:16", resolution: "720p", durationSeconds: 8, personGeneration: "allow_adult" },
    }),
  });
  let op = (await start.json().catch(() => ({}))) as VeoOperation;
  if (!start.ok || !op.name) {
    if (start.status === 401 || start.status === 403) throw new ProviderError("O Google recusou a chave. Confira GOOGLE_AI_API_KEY no Render.");
    if (start.status === 429) throw new ProviderError("Veo sem cota ou ocupado. Confira o faturamento no Google AI Studio e tente de novo.");
    throw new ProviderError(`Veo: ${(op.error?.message ?? `HTTP ${start.status}`).slice(0, 200)}`);
  }
  if (!/^models\/[\w.-]+\/operations\/[\w-]+$/.test(op.name)) throw new ProviderError("Veo: resposta inesperada.");
  const deadline = Date.now() + 10 * 60_000;
  while (!op.done) {
    if (Date.now() > deadline) throw new ProviderError("O Veo demorou mais de 10 minutos. Tente de novo.");
    await sleep(10_000);
    const r = await fetch(`${GEMINI}/${op.name}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) continue; // falha momentânea: tenta na próxima volta
    op = (await r.json()) as VeoOperation;
  }
  if (op.error) throw new ProviderError(`Veo: ${(op.error.message ?? "falha na geração").slice(0, 200)}`);
  const res = op.response?.generateVideoResponse;
  const uri = res?.generatedSamples?.[0]?.video?.uri;
  if (!uri) {
    const why = res?.raiMediaFilteredReasons?.join(" ").slice(0, 200);
    throw new ProviderError(why ? `O Veo recusou o vídeo pelas regras de segurança: ${why}` : "O Veo não devolveu o vídeo.");
  }
  const target = new URL(uri);
  if (target.protocol !== "https:" || target.hostname !== "generativelanguage.googleapis.com") throw new ProviderError("Veo: endereço do vídeo inesperado.");
  const file = await fetch(target, { headers: { "x-goog-api-key": e.GOOGLE_AI_API_KEY }, redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!file.ok) throw new ProviderError(`Não foi possível baixar o vídeo do Veo (HTTP ${file.status}).`);
  return Buffer.from(await file.arrayBuffer());
}
