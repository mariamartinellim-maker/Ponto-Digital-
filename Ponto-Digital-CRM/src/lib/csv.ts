import Papa from "papaparse";
import { normalizePhone, phoneDedupKey } from "./phone";

export interface ImportRow {
  line: number;
  name: string;
  phone: string;
  email: string;
  city: string;
  services: string[];
  notes: string;
  consent: boolean;
}

export interface ImportAnalysis {
  valid: ImportRow[];
  duplicatesInFile: { line: number; name: string; phone: string; firstLine: number }[];
  alreadyExists: { line: number; name: string; phone: string }[];
  invalid: { line: number; reason: string; raw: string }[];
  totalLines: number;
}

const ALIASES: Record<keyof Omit<ImportRow, "line">, string[]> = {
  name: ["nome", "name", "cliente", "empresa", "contato"],
  phone: ["telefone", "phone", "celular", "whatsapp", "fone", "numero", "número"],
  email: ["email", "e-mail", "mail"],
  city: ["cidade", "city", "municipio", "município"],
  services: ["servicos", "serviços", "services", "servico", "serviço"],
  notes: ["observacoes", "observações", "obs", "notas", "notes"],
  consent: ["consentimento", "opt_in", "optin", "aceita_whatsapp", "consent"],
};

const norm = (s: string) =>
  s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_");

function mapHeaders(headers: string[]) {
  const map: Partial<Record<keyof typeof ALIASES, string>> = {};
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof typeof ALIASES, string[]][]) {
    const found = headers.find((h) => aliases.map(norm).includes(norm(h)));
    if (found) map[field] = found;
  }
  return map;
}

const TRUTHY = new Set(["sim", "s", "yes", "y", "true", "1", "x", "opt_in", "aceito"]);
export const MAX_IMPORT_ROWS = 5000;

/**
 * Analisa um CSV de contatos: normaliza telefones, elimina duplicidades dentro do arquivo
 * e em relação à base existente (inclusive variações com/sem nono dígito).
 */
export function analyzeCsv(text: string, existingPhones: string[]): ImportAnalysis {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
  });
  const headers = parsed.meta.fields ?? [];
  const map = mapHeaders(headers);
  const result: ImportAnalysis = { valid: [], duplicatesInFile: [], alreadyExists: [], invalid: [], totalLines: 0 };
  if (!map.name || !map.phone) {
    result.invalid.push({ line: 1, reason: "Cabeçalho precisa conter as colunas 'nome' e 'telefone'.", raw: headers.join(", ") });
    return result;
  }

  const existing = new Set(existingPhones.map(phoneDedupKey));
  const seen = new Map<string, number>();
  const rows = parsed.data.slice(0, MAX_IMPORT_ROWS);
  result.totalLines = rows.length;
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    result.invalid.push({ line: MAX_IMPORT_ROWS + 2, reason: `Limite de ${MAX_IMPORT_ROWS} linhas por importação.`, raw: "" });
  }

  rows.forEach((r, idx) => {
    const line = idx + 2; // +1 cabeçalho, +1 base 1
    const get = (f: keyof typeof ALIASES) => (map[f] ? String(r[map[f]!] ?? "").trim() : "");
    const name = get("name").slice(0, 120);
    const rawPhone = get("phone");
    if (!name) return result.invalid.push({ line, reason: "Nome vazio", raw: Object.values(r).join(", ") });
    const phone = normalizePhone(rawPhone);
    if (!phone) return result.invalid.push({ line, reason: `Telefone inválido: "${rawPhone}"`, raw: name });
    const key = phoneDedupKey(phone);
    if (existing.has(key)) return result.alreadyExists.push({ line, name, phone });
    const first = seen.get(key);
    if (first) return result.duplicatesInFile.push({ line, name, phone, firstLine: first });
    seen.set(key, line);
    const email = get("email").toLowerCase();
    result.valid.push({
      line,
      name,
      phone,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 160) : "",
      city: get("city").slice(0, 80),
      services: get("services")
        .split(/[|;,/]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10),
      notes: get("notes").slice(0, 2000),
      consent: TRUTHY.has(norm(get("consent"))),
    });
  });
  return result;
}
