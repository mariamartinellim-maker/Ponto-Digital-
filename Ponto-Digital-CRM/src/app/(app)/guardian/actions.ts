"use server";

import { revalidatePath } from "next/cache";
import { authorize, clientIp } from "@/lib/auth/session";
import { audit } from "@/lib/data/repo";
import { createBackup, monitorTick, recordEvent, restoreBackup } from "@/lib/guardian/guardian";
import { startWaWeb, wawebConfig } from "@/lib/whatsapp-web/manager";

export type GuardState = { error?: string; ok?: number | string } | undefined;

export async function checkNowAction() {
  await authorize("guardian:manage");
  await monitorTick();
  revalidatePath("/guardian");
}

export async function backupNowAction(): Promise<GuardState> {
  const user = await authorize("guardian:manage");
  try {
    const b = await createBackup("manual");
    await recordEvent("info", "backup", `Backup manual criado: ${b.name}`, user.orgId);
    await audit({ orgId: user.orgId, userId: user.id, action: "guardian.backup", entity: "sistema", entityId: null, details: b.name, ip: await clientIp() });
  } catch (err) {
    return { error: (err as Error).message };
  }
  revalidatePath("/guardian");
  return { ok: "Backup criado." };
}

/** Restauração: exige digitar RESTAURAR e sempre guarda um backup do estado atual antes. */
export async function restoreAction(_: GuardState, formData: FormData): Promise<GuardState> {
  const user = await authorize("guardian:manage");
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "RESTAURAR") return { error: "Digite RESTAURAR para confirmar." };
  const name = String(formData.get("name") ?? "");
  const r = await restoreBackup(name);
  if (!r.ok) return { error: r.error };
  await recordEvent("aviso", "backup", `Base restaurada a partir de ${name} (cópia do estado anterior: ${r.safety})`, user.orgId);
  await audit({ orgId: user.orgId, userId: user.id, action: "guardian.restauracao", entity: "sistema", entityId: null, details: `${name} · segurança: ${r.safety}`, ip: await clientIp() });
  revalidatePath("/", "layout");
  return { ok: `Restaurado. O estado anterior foi guardado em ${r.safety}.` };
}

export async function reconnectWaWebAction(): Promise<GuardState> {
  const user = await authorize("guardian:manage");
  if (!wawebConfig().ready) return { error: "WhatsApp Web experimental desligado ou sem configuração." };
  const r = await startWaWeb(user.orgId);
  if (r.error) return { error: r.error };
  await recordEvent("info", "waweb", "Reconexão manual solicitada pelo Guardian.", user.orgId);
  revalidatePath("/guardian");
  return { ok: "Reconexão iniciada. Se a sessão expirou, leia um novo QR Code em Configurações → WhatsApp Web." };
}
