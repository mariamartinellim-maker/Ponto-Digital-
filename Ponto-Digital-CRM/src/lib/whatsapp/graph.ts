import "server-only";
import { env } from "../env";

/**
 * Chamadas à Graph API oficial da Meta (WhatsApp Cloud API). Nenhum token é registrado em log.
 */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

const base = () => `${env().WHATSAPP_GRAPH_BASE.replace(/\/+$/, "")}/${env().WHATSAPP_GRAPH_VERSION}`;

export async function graph<T = Record<string, unknown>>(
  path: string,
  token: string,
  init: { method?: "GET" | "POST" | "DELETE"; json?: unknown; form?: FormData; query?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL(`${base()}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method: init.method ?? (init.json !== undefined || init.form ? "POST" : "GET"),
    headers,
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_user_msg?: string } };
  if (!res.ok || body.error) {
    const e = body.error;
    throw new GraphError(e?.error_user_msg || e?.message || `Erro HTTP ${res.status} na API da Meta`, res.status, e?.code);
  }
  return body;
}

/** Troca o código do Embedded Signup por um token de integração do negócio. */
export async function exchangeCode(code: string): Promise<string> {
  const e = env();
  const url = new URL(`${base()}/oauth/access_token`);
  url.searchParams.set("client_id", e.META_APP_ID ?? "");
  url.searchParams.set("client_secret", e.WHATSAPP_APP_SECRET ?? "");
  url.searchParams.set("code", code);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } };
  if (!res.ok || !body.access_token) throw new GraphError(body.error?.message ?? "Não foi possível concluir a conexão com a Meta.", res.status);
  return body.access_token;
}

/** Endereço temporário (5 min) e tipo de uma mídia; o download exige o mesmo token. */
export async function mediaInfo(mediaId: string, token: string) {
  return graph<{ url: string; mime_type: string; file_size?: number }>(encodeURIComponent(mediaId), token);
}

export async function downloadMedia(url: string, token: string) {
  const target = new URL(url);
  // Só baixa de domínios da Meta (evita uso do servidor como proxy aberto).
  if (target.protocol !== "https:" || !/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net|fbcdn\.net)$/.test(target.hostname)) {
    if (env().WHATSAPP_GRAPH_BASE === "https://graph.facebook.com") throw new GraphError("Endereço de mídia inesperado.", 400);
  }
  const res = await fetch(target, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000), cache: "no-store" });
  if (!res.ok || !res.body) throw new GraphError(`Falha ao baixar a mídia (HTTP ${res.status}).`, res.status);
  return res;
}

export async function uploadMedia(phoneNumberId: string, token: string, file: Blob, filename: string) {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", file.type);
  form.set("file", file, filename);
  const r = await graph<{ id: string }>(`${phoneNumberId}/media`, token, { form, timeoutMs: 60_000 });
  return r.id;
}
