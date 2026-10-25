import "server-only";
import { supabaseAdmin } from "../supabase/admin";
import { dbError, isSupabase, supabaseServer } from "../supabase/server";
import { getDb, mutate } from "./store";
import type {
  AiSuggestionRecord,
  FinanceEntry,
  GuardianEvent,
  MediaAsset,
  ProductionOrder,
  Receipt,
  Sale,
} from "./types";

/**
 * Acesso às coleções dos módulos operacionais nos dois modos, com a mesma interface:
 *  - demonstração: base local (store.ts);
 *  - Supabase: tabelas com RLS por organização, usando a sessão do usuário (ou a chave do servidor
 *    somente em tarefas sem usuário, como o Guardian e as mídias recebidas pelo WhatsApp Web).
 * Campos em camelCase no código e snake_case no banco.
 */
export interface Collections {
  mediaAssets: MediaAsset;
  receipts: Receipt;
  sales: Sale;
  financeEntries: FinanceEntry;
  productionOrders: ProductionOrder;
  guardianEvents: GuardianEvent;
  aiSuggestions: AiSuggestionRecord;
}
export type CollectionName = keyof Collections;

const TABLE: Record<CollectionName, string> = {
  mediaAssets: "media_assets",
  receipts: "payment_receipts",
  sales: "sales",
  financeEntries: "finance_entries",
  productionOrders: "production_orders",
  guardianEvents: "guardian_events",
  aiSuggestions: "ai_suggestions",
};

export const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
export const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export const toRow = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [toSnake(k), v]));
export const fromRow = <T>(r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v])) as T;

export interface Access {
  /** Usa a chave do servidor (sem usuário logado). Só em tarefas internas. */
  admin?: boolean;
}

async function client(a?: Access) {
  return a?.admin ? supabaseAdmin() : await supabaseServer();
}

function fail(error: { code?: string; message?: string }): never {
  throw new Error(dbError(error));
}

export async function listAll<K extends CollectionName>(
  orgId: string,
  coll: K,
  opts: { where?: Partial<Collections[K]>; order?: keyof Collections[K] & string; desc?: boolean; limit?: number } & Access = {},
): Promise<Collections[K][]> {
  const where = Object.entries(opts.where ?? {});
  if (isSupabase()) {
    let q = (await client(opts)).from(TABLE[coll]).select("*").eq("org_id", orgId);
    for (const [k, v] of where) q = v === null ? q.is(toSnake(k), null) : q.eq(toSnake(k), v as string);
    if (opts.order) q = q.order(toSnake(opts.order), { ascending: !opts.desc });
    const { data, error } = await q.limit(opts.limit ?? 1000);
    if (error) fail(error);
    return (data ?? []).map((r) => fromRow<Collections[K]>(r));
  }
  const db = await getDb();
  let rows = (db[coll] as Collections[K][]).filter((r) => r.orgId === orgId && where.every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
  if (opts.order) {
    const key = opts.order;
    rows = [...rows].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0) * (opts.desc ? -1 : 1));
  }
  return rows.slice(0, opts.limit ?? 1000).map((r) => structuredClone(r));
}

export async function getOne<K extends CollectionName>(orgId: string, coll: K, id: string, a?: Access): Promise<Collections[K] | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (isSupabase()) {
    const { data, error } = await (await client(a)).from(TABLE[coll]).select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? fromRow<Collections[K]>(data) : null;
  }
  const db = await getDb();
  const row = (db[coll] as Collections[K][]).find((r) => r.orgId === orgId && (r as { id?: string }).id === id);
  return row ? structuredClone(row) : null;
}

export async function insertOne<K extends CollectionName>(coll: K, row: Collections[K], a?: Access): Promise<Collections[K]> {
  if (isSupabase()) {
    const { data, error } = await (await client(a)).from(TABLE[coll]).insert(toRow(row)).select("*").single();
    if (error) fail(error);
    return fromRow<Collections[K]>(data);
  }
  await mutate((db) => void (db[coll] as Collections[K][]).push(structuredClone(row)));
  return row;
}

export async function updateOne<K extends CollectionName>(orgId: string, coll: K, id: string, patch: Partial<Collections[K]>, a?: Access): Promise<Collections[K] | null> {
  if (isSupabase()) {
    const { data, error } = await (await client(a)).from(TABLE[coll]).update(toRow(patch)).eq("org_id", orgId).eq("id", id).select("*").maybeSingle();
    if (error) fail(error);
    return data ? fromRow<Collections[K]>(data) : null;
  }
  return mutate((db) => {
    const row = (db[coll] as Collections[K][]).find((r) => r.orgId === orgId && (r as { id?: string }).id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return structuredClone(row);
  });
}

export async function deleteOne(orgId: string, coll: CollectionName, id: string, a?: Access): Promise<boolean> {
  if (isSupabase()) {
    const { error, count } = await (await client(a)).from(TABLE[coll]).delete({ count: "exact" }).eq("org_id", orgId).eq("id", id);
    if (error) fail(error);
    return (count ?? 0) > 0;
  }
  return mutate((db) => {
    const list = db[coll] as { id?: string; orgId: string | null }[];
    const i = list.findIndex((r) => r.orgId === orgId && r.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
  });
}

/** Próximo número sequencial por organização (vendas e ordens de produção). */
export async function nextNumber(orgId: string, coll: "sales" | "productionOrders"): Promise<number> {
  if (isSupabase()) {
    const { data, error } = await (await supabaseServer()).from(TABLE[coll]).select("number").eq("org_id", orgId).order("number", { ascending: false }).limit(1).maybeSingle();
    if (error) fail(error);
    return (Number(data?.number) || 0) + 1;
  }
  const db = await getDb();
  return (db[coll] as { orgId: string; number: number }[]).filter((r) => r.orgId === orgId).reduce((m, r) => Math.max(m, r.number), 0) + 1;
}
