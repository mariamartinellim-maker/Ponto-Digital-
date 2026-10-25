import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { insertOne, type Access } from "../data/collections";
import type { AssetSource, AssetType, MediaAsset } from "../data/types";
import { hasSupabaseAdmin, supabaseAdmin } from "../supabase/admin";
import { isSupabase } from "../supabase/server";

/**
 * Arquivos da biblioteca e dos comprovantes.
 *  - modo demonstração: disco local em .data/arquivos (fora do Git);
 *  - Supabase: bucket PRIVADO do Supabase Storage, acessado só pelo servidor. Quem pode ver cada arquivo
 *    é decidido antes, pela linha de media_assets (RLS por organização).
 */
const BUCKET = "crm-arquivos";
const ROOT = path.join(process.cwd(), ".data", "arquivos");

export const MEDIA_LIMITS: Record<AssetType, { mimes: string[]; max: number; label: string }> = {
  image: { mimes: ["image/jpeg", "image/png", "image/webp"], max: 10 * 1024 * 1024, label: "Imagem" },
  audio: { mimes: ["audio/mpeg", "audio/ogg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/webm"], max: 16 * 1024 * 1024, label: "Áudio" },
  video: { mimes: ["video/mp4", "video/webm", "video/3gpp", "video/quicktime"], max: 50 * 1024 * 1024, label: "Vídeo" },
  document: { mimes: ["application/pdf"], max: 16 * 1024 * 1024, label: "Documento (PDF)" },
};

export function classifyUpload(mime: string, size: number): { type: AssetType } | { error: string } {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  for (const [type, rule] of Object.entries(MEDIA_LIMITS) as [AssetType, (typeof MEDIA_LIMITS)[AssetType]][]) {
    if (!rule.mimes.includes(base)) continue;
    if (size === 0) return { error: "Arquivo vazio." };
    if (size > rule.max) return { error: `${rule.label} muito grande (máx. ${rule.max / 1024 / 1024} MB).` };
    return { type };
  }
  return { error: "Tipo de arquivo não aceito. Use JPG, PNG, WEBP, MP3, OGG, M4A, WAV, MP4, WEBM, MOV ou PDF." };
}

/** Confere a assinatura do arquivo (os primeiros bytes), não só o tipo informado pelo navegador. */
export function sniffMatches(type: AssetType, bytes: Uint8Array): boolean {
  const b = (i: number) => bytes[i] ?? -1;
  const ascii = (from: number, len: number) => String.fromCharCode(...bytes.slice(from, from + len));
  if (type === "image") return (b(0) === 0xff && b(1) === 0xd8) || ascii(1, 3) === "PNG" || (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP");
  if (type === "document") return ascii(0, 5) === "%PDF-";
  if (type === "audio")
    return ascii(0, 3) === "ID3" || (b(0) === 0xff && (b(1) & 0xe0) === 0xe0) || ascii(0, 4) === "OggS" || ascii(4, 4) === "ftyp" || ascii(0, 4) === "RIFF" || (b(0) === 0x1a && b(1) === 0x45);
  return ascii(4, 4) === "ftyp" || (b(0) === 0x1a && b(1) === 0x45 && b(2) === 0xdf);
}

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const db = supabaseAdmin();
  const { data } = await db.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 50 * 1024 * 1024 });
    if (error && !/exists/i.test(error.message)) throw new Error(`Não foi possível preparar o armazenamento: ${error.message}`);
  }
  bucketReady = true;
}

export function storageReady(): { ok: boolean; reason?: string } {
  if (!isSupabase()) return { ok: true };
  return hasSupabaseAdmin() ? { ok: true } : { ok: false, reason: "O armazenamento de arquivos exige SUPABASE_SECRET_KEY no servidor." };
}

const localPath = (key: string) => {
  const p = path.join(ROOT, key);
  if (!p.startsWith(ROOT + path.sep)) throw new Error("Caminho inválido.");
  return p;
};

export async function putFile(key: string, bytes: Uint8Array, mime: string) {
  if (isSupabase()) {
    await ensureBucket();
    const { error } = await supabaseAdmin().storage.from(BUCKET).upload(key, bytes, { contentType: mime, upsert: false });
    if (error) throw new Error(`Falha ao gravar o arquivo: ${error.message}`);
    return;
  }
  const p = localPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, bytes, { mode: 0o600 });
}

export async function getFile(key: string): Promise<Buffer | null> {
  if (isSupabase()) {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(key);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }
  return readFile(localPath(key)).catch(() => null);
}

export async function removeFile(key: string) {
  if (isSupabase()) {
    await supabaseAdmin().storage.from(BUCKET).remove([key]);
    return;
  }
  await rm(localPath(key), { force: true });
}

const safeName = (name: string) => name.replace(/[^\w.\- ()À-ú]/g, "_").slice(0, 120) || "arquivo";

/** Grava o arquivo e registra na biblioteca. */
export async function saveAsset(
  input: { orgId: string; bytes: Uint8Array; mime: string; filename: string; title?: string; tags?: string[]; source: AssetSource; clientId?: string | null; createdBy: string | null },
  a?: Access,
): Promise<MediaAsset | { error: string }> {
  const ready = storageReady();
  if (!ready.ok) return { error: ready.reason! };
  const kind = classifyUpload(input.mime, input.bytes.byteLength);
  if ("error" in kind) return kind;
  if (!sniffMatches(kind.type, input.bytes)) return { error: "O conteúdo do arquivo não corresponde ao tipo informado." };
  const id = randomUUID();
  const filename = safeName(input.filename);
  const storageKey = `${input.orgId}/${id}/${filename}`;
  await putFile(storageKey, input.bytes, input.mime.split(";")[0]!.trim().toLowerCase());
  const asset: MediaAsset = {
    id,
    orgId: input.orgId,
    title: (input.title?.trim() || filename).slice(0, 160),
    type: kind.type,
    mime: input.mime.split(";")[0]!.trim().toLowerCase(),
    size: input.bytes.byteLength,
    filename,
    tags: (input.tags ?? []).map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 10),
    source: input.source,
    clientId: input.clientId ?? null,
    storageKey,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  };
  try {
    return await insertOne("mediaAssets", asset, a);
  } catch (err) {
    await removeFile(storageKey).catch(() => {});
    return { error: (err as Error).message };
  }
}
