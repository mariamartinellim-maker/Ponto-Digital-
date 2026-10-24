import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSeed } from "./seed";
import type { Database } from "./types";

/**
 * Armazenamento do MODO DEMONSTRAÇÃO: base em memória, persistida em `.data/demo-db.json`
 * (fora do Git). Em produção, este módulo é substituído pelo Supabase/PostgreSQL
 * (ver `supabase/migrations`). Toda leitura/escrita passa por `repo.ts`, que filtra por organização.
 */
const FILE = path.join(process.cwd(), ".data", "demo-db.json");
const DB_VERSION = 1;

const g = globalThis as unknown as { __pdDb?: Promise<Database>; __pdSaveTimer?: NodeJS.Timeout };

async function load(): Promise<Database> {
  try {
    if (process.env.NODE_ENV === "test") throw new Error("test");
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Database;
    if (parsed.version === DB_VERSION) return parsed;
  } catch {
    // arquivo ainda não existe: cria a base demonstrativa
  }
  const db = await buildSeed();
  await persist(db);
  return db;
}

async function persist(db: Database) {
  if (process.env.NODE_ENV === "test") return; // testes rodam só em memória
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(db), { mode: 0o600 });
    await rename(tmp, FILE);
  } catch (err) {
    // Ambientes sem disco gravável (ex.: serverless) seguem só em memória.
    console.warn("[demo-db] não foi possível salvar em disco:", (err as Error).message);
  }
}

export function getDb(): Promise<Database> {
  g.__pdDb ??= load().catch((err) => {
    g.__pdDb = undefined; // permite nova tentativa após corrigir a configuração
    throw err;
  });
  return g.__pdDb;
}

/** Executa uma alteração e agenda a gravação em disco. */
export async function mutate<T>(fn: (db: Database) => T): Promise<T> {
  const db = await getDb();
  const result = fn(db);
  clearTimeout(g.__pdSaveTimer);
  g.__pdSaveTimer = setTimeout(() => void persist(db), 150);
  return result;
}

/** Restaura os dados demonstrativos (apenas modo demo). */
export async function resetDemo() {
  const db = await buildSeed();
  g.__pdDb = Promise.resolve(db);
  await persist(db);
}
