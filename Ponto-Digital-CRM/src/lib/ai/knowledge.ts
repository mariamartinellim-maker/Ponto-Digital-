import "server-only";
import { randomUUID } from "node:crypto";
import { getDb, mutate } from "../data/store";
import type { AiSuggestionRecord } from "../data/types";
import { isSupabase, supabaseServer } from "../supabase/server";
import { KNOWLEDGE_FIELDS, type Knowledge } from "./prompt";

/*
 * Base de conhecimento e histórico de sugestões da IA nos dois modos:
 * Supabase (tabelas ai_knowledge / ai_suggestions) ou base local de demonstração/testes.
 * O conteúdo da base (personalidade, preços, regras comerciais) é preenchido pelo proprietário.
 */

export type StoredKnowledge = Knowledge & { enabled: boolean };

const monthStart = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(3, 0, 0, 0); // meia-noite em Brasília
  return d.toISOString();
};

export async function loadKnowledge(orgId: string): Promise<StoredKnowledge | null> {
  if (isSupabase()) {
    const { data: k } = await (await supabaseServer()).from("ai_knowledge").select("*").maybeSingle();
    if (!k) return null;
    return { enabled: k.enabled === true, ...(Object.fromEntries(KNOWLEDGE_FIELDS.map((f) => [f.key, String(k[f.key] ?? "")])) as unknown as Knowledge) };
  }
  const k = (await getDb()).aiKnowledge.find((x) => x.orgId === orgId);
  if (!k) return null;
  return { enabled: k.enabled, ...(Object.fromEntries(KNOWLEDGE_FIELDS.map((f) => [f.key, k[f.key]])) as unknown as Knowledge) };
}

/** Modo demonstração (no Supabase a gravação continua em ia/actions.ts, com RLS). */
export async function saveKnowledgeDemo(orgId: string, userId: string, enabled: boolean, kb: Knowledge) {
  await mutate((db) => {
    const rec = { orgId, enabled, ...kb, updatedBy: userId, updatedAt: new Date().toISOString() };
    const i = db.aiKnowledge.findIndex((x) => x.orgId === orgId);
    if (i >= 0) db.aiKnowledge[i] = rec;
    else db.aiKnowledge.push(rec);
  });
}

export interface AiUsage {
  count: number;
  used: number;
  input: number;
  output: number;
  cached: number;
}

export async function usageThisMonth(orgId: string): Promise<AiUsage> {
  const usage: AiUsage = { count: 0, used: 0, input: 0, output: 0, cached: 0 };
  const since = monthStart();
  const rows = isSupabase()
    ? ((await (await supabaseServer()).from("ai_suggestions").select("status,input_tokens,output_tokens,cache_read_tokens").gte("created_at", since).limit(10000)).data ?? []).map((r) => ({
        status: r.status,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
      }))
    : (await getDb()).aiSuggestions.filter((s) => s.orgId === orgId && s.createdAt >= since);
  for (const r of rows) {
    usage.count++;
    if (r.status === "usada") usage.used++;
    usage.input += Number(r.inputTokens) || 0;
    usage.output += Number(r.outputTokens) || 0;
    usage.cached += Number(r.cacheReadTokens) || 0;
  }
  return usage;
}

export async function recordSuggestionDemo(rec: Omit<AiSuggestionRecord, "id" | "status" | "createdAt">): Promise<string> {
  const id = randomUUID();
  await mutate((db) => void db.aiSuggestions.push({ ...rec, id, status: "sugerida", createdAt: new Date().toISOString() }));
  return id;
}

export async function setSuggestionStatusDemo(orgId: string, id: string, status: "usada" | "descartada") {
  await mutate((db) => {
    const s = db.aiSuggestions.find((x) => x.id === id && x.orgId === orgId);
    if (s && s.status === "sugerida") s.status = status;
  });
}
