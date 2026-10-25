"use server";

import { authorize, clientIp } from "@/lib/auth/session";
import { audit } from "@/lib/data/repo";
import { logoutWaWeb, pauseWaWeb, startWaWeb } from "@/lib/whatsapp-web/manager";

export type WebActionState = { error?: string; ok?: string } | undefined;

export async function startWaWebAction(): Promise<WebActionState> {
  const user = await authorize("settings:manage");
  const r = await startWaWeb(user.orgId);
  if (r.error) return { error: r.error };
  await audit({ orgId: user.orgId, userId: user.id, action: "whatsapp_web.conectar", entity: "whatsapp_web", entityId: null, details: "QR Code gerado (módulo experimental)", ip: await clientIp() });
  return { ok: "Conexão iniciada." };
}

export async function pauseWaWebAction(): Promise<WebActionState> {
  const user = await authorize("settings:manage");
  await pauseWaWeb();
  await audit({ orgId: user.orgId, userId: user.id, action: "whatsapp_web.pausar", entity: "whatsapp_web", entityId: null, ip: await clientIp() });
  return { ok: "Conexão pausada. A sessão continua salva." };
}

export async function logoutWaWebAction(): Promise<WebActionState> {
  const user = await authorize("settings:manage");
  await logoutWaWeb(user.orgId);
  await audit({ orgId: user.orgId, userId: user.id, action: "whatsapp_web.desvincular", entity: "whatsapp_web", entityId: null, details: "Aparelho desvinculado e sessão apagada", ip: await clientIp() });
  return { ok: "Aparelho desvinculado e sessão apagada." };
}
