import "server-only";

/**
 * Limitador simples em memória (janela fixa). Suficiente para uma instância;
 * em produção com várias instâncias, trocar por Redis/Upstash ou tabela no Postgres.
 */
const g = globalThis as unknown as { __pdRate?: Map<string, { count: number; resetAt: number }> };
const buckets = (g.__pdRate ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  b.count++;
  return { ok: b.count <= limit, retryAfterMs: b.resetAt - now };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}
