"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { authorize, clientIp } from "@/lib/auth/session";
import { deleteOne, getOne, listAll } from "@/lib/data/collections";
import { audit } from "@/lib/data/repo";
import type { MessageMedia } from "@/lib/data/types";
import { loadTarget, recordOutgoing } from "@/lib/inbox-send";
import { removeFile } from "@/lib/media/storage";

export type LibState = { error?: string; ok?: number | string } | undefined;

const LABEL = { image: "imagem", audio: "áudio", video: "vídeo", document: "documento" } as const;

export async function deleteAssetAction(formData: FormData) {
  const user = await authorize("media:manage");
  const id = String(formData.get("id"));
  const asset = await getOne(user.orgId, "mediaAssets", id);
  if (!asset) return;
  if ((await listAll(user.orgId, "receipts", { where: { mediaId: id } })).length) throw new Error("Este arquivo é um comprovante registrado no Financeiro e não pode ser excluído.");
  if (await deleteOne(user.orgId, "mediaAssets", id)) await removeFile(asset.storageKey).catch(() => {});
  await audit({ orgId: user.orgId, userId: user.id, action: "biblioteca.arquivo_excluido", entity: "midia", entityId: id, details: asset.title, ip: await clientIp() });
  revalidatePath("/biblioteca");
}

/**
 * Usa um arquivo da biblioteca numa conversa. Nesta fase o envio é SEMPRE simulado:
 * a mensagem fica registrada no CRM e nada sai para o WhatsApp.
 */
export async function sendAssetAction(_: LibState, formData: FormData): Promise<LibState> {
  const user = await authorize("inbox:reply");
  const asset = await getOne(user.orgId, "mediaAssets", String(formData.get("assetId")));
  if (!asset || asset.tags.includes("comprovante")) return { error: "Arquivo não encontrado." };
  let target;
  try {
    target = await loadTarget(user, String(formData.get("conversationId")));
  } catch {
    return { error: "Escolha uma conversa." };
  }
  const caption = String(formData.get("caption") ?? "").trim().slice(0, 1024);
  const media: MessageMedia = { type: asset.type, mime: asset.mime, filename: asset.filename, assetId: asset.id, simulated: true, ...(caption ? { caption } : {}) };
  const err = await recordOutgoing(user, target.conv, `[${LABEL[asset.type]}] ${caption || asset.title}`.slice(0, 4096), true, `wamid.SIMULADO.${randomUUID()}`, { media });
  if (err) return { error: err };
  revalidatePath(`/inbox/${target.conv.id}`);
  return { ok: "Registrado na conversa (envio simulado — nada foi enviado ao WhatsApp)." };
}
