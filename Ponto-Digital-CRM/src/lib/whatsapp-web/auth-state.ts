import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from "baileys";
import { env } from "../env";
import { supabaseAdmin } from "../supabase/admin";
import { isSupabase } from "../supabase/server";
import { decryptSecret, encryptSecret } from "../whatsapp/crypto";

/**
 * Sessão do WhatsApp Web (credenciais e chaves de criptografia do aparelho vinculado).
 * Guardada num único bloco criptografado (AES-256-GCM):
 *  - modo Supabase: tabela public.waweb_sessions, acessível só pelo servidor — sobrevive a deploys no Render;
 *  - modo demonstração: arquivo em .data/whatsapp-web (fora do Git).
 * Quem tiver acesso ao banco ou ao disco não consegue usar a sessão sem a chave do servidor.
 */
export interface SessionStore {
  load(): Promise<string | null>;
  save(box: string, phone: string | null): Promise<void>;
  clear(): Promise<void>;
}

function fileStore(orgId: string): SessionStore {
  const file = path.join(process.cwd(), ".data", "whatsapp-web", `${orgId.replace(/[^\w-]/g, "")}.enc`);
  return {
    load: () => readFile(file, "utf8").catch(() => null),
    async save(box) {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, box, { mode: 0o600 });
      await rename(tmp, file);
    },
    clear: () => rm(file, { force: true }),
  };
}

function supabaseStore(orgId: string): SessionStore {
  return {
    async load() {
      const { data, error } = await supabaseAdmin().from("waweb_sessions").select("session_enc").eq("org_id", orgId).maybeSingle();
      if (error) throw new Error(`Falha ao ler a sessão: ${error.message}`);
      return data?.session_enc ? String(data.session_enc) : null;
    },
    async save(box, phone) {
      const { error } = await supabaseAdmin()
        .from("waweb_sessions")
        .upsert({ org_id: orgId, session_enc: box, phone, updated_at: new Date().toISOString() });
      if (error) throw new Error(`Falha ao salvar a sessão: ${error.message}`);
    },
    async clear() {
      await supabaseAdmin().from("waweb_sessions").delete().eq("org_id", orgId);
    },
  };
}

export const sessionStore = (orgId: string) => (isSupabase() ? supabaseStore(orgId) : fileStore(orgId));

/** Organização com sessão salva (para reconectar quando o servidor reinicia). */
export async function savedSessionOrg(): Promise<string | null> {
  if (!isSupabase()) return null; // modo demo: a reconexão é feita pela organização única (ver manager)
  const { data } = await supabaseAdmin().from("waweb_sessions").select("org_id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data?.org_id ? String(data.org_id) : null;
}

/** Chave da sessão: WAWEB_SESSION_KEY; no modo demo, derivada do SESSION_SECRET local. */
export function sessionKey(): string | null {
  const e = env();
  if (e.WAWEB_SESSION_KEY) return e.WAWEB_SESSION_KEY;
  if (e.DATA_BACKEND === "demo" && e.SESSION_SECRET) return createHash("sha256").update(`waweb:${e.SESSION_SECRET}`).digest("base64");
  return null;
}

interface Snapshot {
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
}

/** Estado de autenticação no formato da biblioteca, gravado com atraso curto (agrupa rajadas de chaves). */
export async function loadAuthState(store: SessionStore, key: string, phone: () => string | null) {
  const box = await store.load();
  let snap: Snapshot;
  try {
    snap = box ? (JSON.parse(decryptSecret(box, key), BufferJSON.reviver) as Snapshot) : { creds: initAuthCreds(), keys: {} };
  } catch {
    // Chave trocada ou bloco corrompido: começa do zero (novo QR) em vez de travar.
    console.warn("[whatsapp-web] sessão salva ilegível; será preciso ler o QR Code novamente");
    snap = { creds: initAuthCreds(), keys: {} };
  }

  let timer: NodeJS.Timeout | undefined;
  let saving = Promise.resolve();
  let disposed = false; // depois de apagada, nenhuma gravação atrasada recria a sessão
  const persist = () => {
    if (disposed) return saving;
    saving = saving
      .then(() => store.save(encryptSecret(JSON.stringify(snap, BufferJSON.replacer), key), phone()))
      .catch((err) => console.error("[whatsapp-web] não foi possível salvar a sessão:", (err as Error).message));
    return saving;
  };
  const schedule = () => {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void persist(), 800);
  };

  const state: AuthenticationState = {
    creds: snap.creds,
    keys: {
      get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
        const bucket = snap.keys[type] ?? {};
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          let v = bucket[id];
          if (v === undefined) continue;
          if (type === "app-state-sync-key") v = proto.Message.AppStateSyncKeyData.fromObject(v as object);
          out[id] = v as SignalDataTypeMap[T];
        }
        return out;
      },
      set(data) {
        for (const [type, entries] of Object.entries(data)) {
          const bucket = (snap.keys[type] ??= {});
          for (const [id, value] of Object.entries(entries ?? {})) {
            if (value === null || value === undefined) delete bucket[id];
            else bucket[id] = value;
          }
        }
        schedule();
      },
    },
  };

  return {
    state,
    registered: Boolean(box && snap.creds.registered),
    saveCreds: schedule,
    async flush() {
      clearTimeout(timer);
      await persist();
    },
    async clear() {
      disposed = true;
      clearTimeout(timer);
      await saving;
      await store.clear();
    },
  };
}
export type LoadedAuth = Awaited<ReturnType<typeof loadAuthState>>;
