// Formatação determinística (igual no servidor e no navegador, evita divergência de hidratação).
const num2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const TZ = "America/Sao_Paulo";

/** Horário da requisição — usado em Server Components (renderizados a cada acesso). */
export const requestTime = () => Date.now();

export const money = (cents: number) => `R$ ${num2.format(cents / 100)}`;
export function moneyCompact(cents: number) {
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return `R$ ${num1.format(v / 1_000_000)} mi`;
  if (Math.abs(v) >= 1_000) return `R$ ${num1.format(v / 1_000)} mil`;
  return `R$ ${num1.format(v)}`;
}

export function parseMoneyToCents(value: string): number | null {
  const s = value.replace(/R\$|\s/g, "");
  if (!s) return 0;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0 || n > 1e10) return null;
  return Math.round(n * 100);
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: TZ }).format(new Date(iso));
}
export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TZ }).format(
    new Date(iso),
  );
}
export function formatTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: TZ }).format(new Date(iso));
}

export function relativeTime(iso: string, now = Date.now()) {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return "agora";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Data local (America/Sao_Paulo) em YYYY-MM-DD. */
export function localDay(iso: string | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
}
