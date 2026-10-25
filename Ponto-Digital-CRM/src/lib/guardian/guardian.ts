import "server-only";
import { randomUUID } from "node:crypto";
import { access, constants, copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DEMO_DB_FILE, DEMO_DB_VERSION, flushDb, getDb, mutate, replaceDb } from "../data/store";
import { LATER_COLLECTIONS, type Database, type GuardianEvent, type GuardianLevel } from "../data/types";
import { env } from "../env";
import { hasSupabaseAdmin, supabaseAdmin } from "../supabase/admin";
import { isSupabase } from "../supabase/server";
import { startWaWeb, wawebConfig, wawebState } from "../whatsapp-web/manager";

/**
 * Guardian: monitoramento contínuo e recuperação SEGURA.
 *  - verificações de saúde (configuração, banco, arquivos, WhatsApp, IA, memória, backups);
 *  - registro de eventos (o que falhou e quando);
 *  - recuperação automática apenas de ações reversíveis (reconectar o WhatsApp Web com a sessão salva);
 *  - backups da base demo com rotação e restauração manual (sempre com backup do estado atual antes).
 * Nunca apaga dados de clientes, nunca envia mensagens e nunca altera configurações de produção.
 */

export type CheckStatus = "ok" | "aviso" | "erro";
export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

const BACKUP_DIR = path.join(process.cwd(), ".data", "backups");
const MAX_BACKUPS = 20;
const MEMORY_LIMIT_MB = 512; // plano Starter do Render

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
export async function recordEvent(level: GuardianLevel, source: string, message: string, orgId: string | null = null) {
  const ev: GuardianEvent = { id: randomUUID(), orgId, level, source: source.slice(0, 40), message: message.slice(0, 500), at: new Date().toISOString() };
  if (level !== "info") console.warn(`[guardian] ${level} ${source}: ${message}`);
  try {
    if (isSupabase()) {
      if (!hasSupabaseAdmin()) return;
      await supabaseAdmin().from("guardian_events").insert({ id: ev.id, org_id: orgId, level, source: ev.source, message: ev.message, at: ev.at });
      return;
    }
    await mutate((db) => {
      db.guardianEvents.unshift(ev);
      if (db.guardianEvents.length > 2000) db.guardianEvents.length = 2000;
    });
  } catch (err) {
    console.error("[guardian] evento não registrado:", (err as Error).message);
  }
}

export async function recentEvents(orgId: string, limit = 100): Promise<GuardianEvent[]> {
  if (isSupabase()) {
    if (!hasSupabaseAdmin()) return [];
    const { data } = await supabaseAdmin().from("guardian_events").select("*").or(`org_id.is.null,org_id.eq.${orgId}`).order("at", { ascending: false }).limit(limit);
    return (data ?? []).map((r) => ({ id: String(r.id), orgId: r.org_id ? String(r.org_id) : null, level: r.level as GuardianLevel, source: String(r.source), message: String(r.message), at: String(r.at) }));
  }
  return (await getDb()).guardianEvents.filter((e) => !e.orgId || e.orgId === orgId).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Verificações
// ---------------------------------------------------------------------------
async function timed<T>(fn: () => Promise<T>, ms = 5000): Promise<T> {
  return Promise.race([fn(), new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`sem resposta em ${ms / 1000} s`)), ms))]);
}

export async function runChecks(): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => out.push({ id, label, status, detail });

  let e: ReturnType<typeof env> | null = null;
  try {
    e = env();
    add("config", "Configuração do servidor", "ok", `Modo ${e.DATA_BACKEND === "supabase" ? "Supabase" : "demonstração"}`);
  } catch (err) {
    add("config", "Configuração do servidor", "erro", (err as Error).message.split("\n")[0]!.slice(0, 200));
    return out;
  }

  // Banco
  try {
    if (isSupabase()) {
      if (!hasSupabaseAdmin()) add("db", "Banco de dados", "aviso", "Sem SUPABASE_SECRET_KEY: o Guardian não consegue testar o banco sozinho.");
      else {
        const t = Date.now();
        const { error } = await timed(async () => await supabaseAdmin().from("organizations").select("id", { head: true, count: "exact" }));
        if (error) throw new Error(error.message);
        add("db", "Banco de dados", "ok", `Supabase respondeu em ${Date.now() - t} ms`);
      }
    } else {
      const db = await getDb();
      const dir = path.dirname(DEMO_DB_FILE);
      await mkdir(dir, { recursive: true });
      await access(dir, constants.W_OK);
      add("db", "Banco de dados", "ok", `Base local com ${db.clients.length} clientes, gravável`);
    }
  } catch (err) {
    add("db", "Banco de dados", "erro", (err as Error).message.slice(0, 200));
  }

  // Arquivos
  if (isSupabase()) add("files", "Armazenamento de arquivos", hasSupabaseAdmin() ? "ok" : "aviso", hasSupabaseAdmin() ? "Supabase Storage (bucket privado)" : "Biblioteca e comprovantes exigem SUPABASE_SECRET_KEY.");
  else {
    try {
      const dir = path.join(process.cwd(), ".data", "arquivos");
      await mkdir(dir, { recursive: true });
      await access(dir, constants.W_OK);
      add("files", "Armazenamento de arquivos", "ok", "Disco local gravável");
    } catch (err) {
      add("files", "Armazenamento de arquivos", "erro", (err as Error).message.slice(0, 200));
    }
  }

  // WhatsApp Web experimental
  const cfg = wawebConfig();
  const ws = wawebState();
  if (!cfg.enabled) add("waweb", "WhatsApp Web (experimental)", "ok", "Desligado");
  else if (ws.status === "conectado") add("waweb", "WhatsApp Web (experimental)", "ok", `Conectado · ${ws.received} mensagem(ns) gravada(s)`);
  else if (ws.status === "erro" || ws.status === "bloqueado") add("waweb", "WhatsApp Web (experimental)", "aviso", ws.lastError ?? ws.status);
  else add("waweb", "WhatsApp Web (experimental)", "ok", ws.status.replace("_", " "));

  // Travas de envio
  const locks = e.WHATSAPP_SEND_MODE === "simulacao" && !e.WHATSAPP_CAMPAIGNS_LIVE;
  add("locks", "Travas de envio", locks ? "ok" : "aviso", locks ? "Envios e campanhas em simulação" : `Envio real ${e.WHATSAPP_SEND_MODE === "live" ? "LIGADO" : "desligado"} · campanhas ${e.WHATSAPP_CAMPAIGNS_LIVE ? "LIBERADAS" : "simuladas"}`);

  // IA
  add("ai", "Inteligência artificial", e.ANTHROPIC_API_KEY ? "ok" : "aviso", e.ANTHROPIC_API_KEY ? `Modelo ${e.AI_MODEL}` : "Sem ANTHROPIC_API_KEY: sugestões e leitura de comprovantes desligadas");

  // Memória
  const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
  add("memory", "Memória do servidor", rss > MEMORY_LIMIT_MB * 0.85 ? "aviso" : "ok", `${rss} MB em uso (limite do plano: ${MEMORY_LIMIT_MB} MB)`);

  // Backups
  if (isSupabase()) add("backup", "Backups", "ok", "Feitos pelo Supabase (diários no plano gratuito). Exportação JSON disponível aqui.");
  else {
    const list = await listBackups();
    const last = list[0];
    const ageH = last ? (Date.now() - new Date(last.at).getTime()) / 3600_000 : Infinity;
    add("backup", "Backups", ageH <= 24 ? "ok" : "aviso", last ? `Último há ${ageH < 1 ? "menos de 1 h" : `${Math.floor(ageH)} h`} · ${list.length} guardado(s)` : "Nenhum backup ainda");
  }
  return out;
}

export const overallStatus = (checks: HealthCheck[]): CheckStatus => (checks.some((c) => c.status === "erro") ? "erro" : checks.some((c) => c.status === "aviso") ? "aviso" : "ok");

// ---------------------------------------------------------------------------
// Backups (modo demonstração)
// ---------------------------------------------------------------------------
export interface BackupInfo {
  name: string;
  at: string;
  size: number;
}

const BACKUP_RE = /^demo-db-(\d{8}T\d{6}Z)(-[a-z]+)?\.json$/;

export async function listBackups(): Promise<BackupInfo[]> {
  const names = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  const out: BackupInfo[] = [];
  for (const name of names.filter((n) => BACKUP_RE.test(n))) {
    const s = await stat(path.join(BACKUP_DIR, name)).catch(() => null);
    if (s) out.push({ name, at: s.mtime.toISOString(), size: s.size });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export async function createBackup(reason = "manual"): Promise<BackupInfo> {
  if (isSupabase()) throw new Error("No Supabase, os backups são feitos pelo próprio Supabase.");
  await flushDb();
  await mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const name = `demo-db-${stamp}-${reason.replace(/[^a-z]/g, "").slice(0, 12) || "manual"}.json`;
  await copyFile(DEMO_DB_FILE, path.join(BACKUP_DIR, name));
  const all = await listBackups();
  for (const old of all.slice(MAX_BACKUPS)) await rm(path.join(BACKUP_DIR, old.name), { force: true });
  return all.find((b) => b.name === name) ?? { name, at: new Date().toISOString(), size: 0 };
}

/** Valida a estrutura antes de restaurar: versão e todas as coleções obrigatórias. */
export function validateBackup(raw: unknown): raw is Database {
  if (!raw || typeof raw !== "object") return false;
  const d = raw as Record<string, unknown>;
  if (d.version !== DEMO_DB_VERSION) return false;
  const required = ["organizations", "users", "clients", "deals", "conversations", "messages", "auditLogs"];
  if (!required.every((k) => Array.isArray(d[k]))) return false;
  if (!(d.organizations as unknown[]).length || !(d.users as unknown[]).length) return false;
  return LATER_COLLECTIONS.every((k) => d[k] === undefined || Array.isArray(d[k]));
}

export async function restoreBackup(name: string): Promise<{ ok: true; safety: string } | { ok: false; error: string }> {
  if (isSupabase()) return { ok: false, error: "Restauração automática só no modo demonstração. No Supabase, use os backups do painel do Supabase." };
  if (!BACKUP_RE.test(name)) return { ok: false, error: "Backup inválido." };
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(BACKUP_DIR, name), "utf8"));
  } catch {
    return { ok: false, error: "Não foi possível ler o backup." };
  }
  if (!validateBackup(raw)) return { ok: false, error: "O arquivo de backup não tem a estrutura esperada. Nada foi alterado." };
  const safety = await createBackup("antesrestaurar");
  await replaceDb(raw);
  return { ok: true, safety: safety.name };
}

// ---------------------------------------------------------------------------
// Monitor contínuo
// ---------------------------------------------------------------------------
const g = globalThis as unknown as { __guardian?: { timer: NodeJS.Timeout; last: Map<string, CheckStatus>; lastRecovery: number; lastBackup: number } };

export async function monitorTick() {
  const st = (g.__guardian ??= { timer: undefined as unknown as NodeJS.Timeout, last: new Map(), lastRecovery: 0, lastBackup: 0 });
  const checks = await runChecks().catch((err) => [{ id: "guardian", label: "Guardian", status: "erro" as const, detail: (err as Error).message }]);
  for (const c of checks) {
    const prev = st.last.get(c.id);
    if (prev && prev !== c.status) await recordEvent(c.status === "ok" ? "info" : c.status, c.id, `${c.label}: ${prev} → ${c.status} (${c.detail})`);
    st.last.set(c.id, c.status);
  }
  // Recuperação segura: reconecta o WhatsApp Web com a sessão salva (no máximo a cada 10 min).
  const ws = wawebState();
  if (wawebConfig().ready && ws.status === "erro" && ws.orgId && Date.now() - st.lastRecovery > 10 * 60_000) {
    st.lastRecovery = Date.now();
    await recordEvent("aviso", "waweb", "Tentando reconectar o WhatsApp Web automaticamente.", ws.orgId);
    const r = await startWaWeb(ws.orgId);
    if (r.error) await recordEvent("erro", "waweb", `Reconexão automática falhou: ${r.error}`, ws.orgId);
  }
  // Backup automático da base demo a cada 6 h.
  if (!isSupabase() && Date.now() - st.lastBackup > 6 * 3600_000) {
    st.lastBackup = Date.now();
    await createBackup("auto").catch((err) => recordEvent("erro", "backup", `Backup automático falhou: ${(err as Error).message}`));
  }
  return checks;
}

export function startGuardianMonitor(intervalMs = 60_000) {
  if (g.__guardian?.timer) return;
  void recordEvent("info", "guardian", "Servidor iniciado; monitoramento ativo.");
  const st = (g.__guardian ??= { timer: undefined as unknown as NodeJS.Timeout, last: new Map(), lastRecovery: 0, lastBackup: 0 });
  st.timer = setInterval(() => void monitorTick(), intervalMs);
  st.timer.unref?.();
  setTimeout(() => void monitorTick(), 5000).unref?.();
}
