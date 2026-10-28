"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, clientIp } from "@/lib/auth/session";
import { audit } from "@/lib/data/repo";
import { env } from "@/lib/env";
import { hasSupabaseAdmin, supabaseAdmin } from "@/lib/supabase/admin";
import { isSupabase } from "@/lib/supabase/server";
import { waCredentials } from "@/lib/whatsapp/client";
import { encryptSecret } from "@/lib/whatsapp/crypto";
import { exchangeCode, graph, GraphError } from "@/lib/whatsapp/graph";
import { updateBusinessProfile, VERTICALS } from "@/lib/whatsapp/profile";

export type ConnectState = { error?: string; ok?: string } | undefined;

interface PhoneInfo {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  is_on_biz_app?: boolean;
  platform_type?: string;
}

const phoneInfo = (phoneNumberId: string, token: string) =>
  graph<PhoneInfo>(phoneNumberId, token, { query: { fields: "id,display_phone_number,verified_name,is_on_biz_app,platform_type" } });

/** Pede à Meta a cópia única (por conexão) dos contatos e do histórico do app WhatsApp Business. */
async function requestSync(phoneNumberId: string, token: string, type: "smb_app_state_sync" | "history") {
  try {
    await graph(`${phoneNumberId}/smb_app_data`, token, { json: { messaging_product: "whatsapp", sync_type: type } });
    return null;
  } catch (err) {
    // Já solicitado nesta conexão: não é erro.
    if (err instanceof GraphError && err.code === 135000) return null;
    return err instanceof Error ? err.message : "falha";
  }
}

const finishSchema = z.object({
  code: z.string().min(10).max(2000),
  event: z.string().max(80),
  phoneNumberId: z.string().regex(/^\d{5,25}$/),
  wabaId: z.string().regex(/^\d{5,25}$/),
});

/**
 * Conclui a conexão por COEXISTÊNCIA (Embedded Signup da Meta, fluxo do app WhatsApp Business).
 * O número continua no app do celular: este fluxo NUNCA chama o registro do número (/register),
 * que é o passo de uma migração convencional.
 */
export async function finishCoexistenceAction(input: z.infer<typeof finishSchema>): Promise<ConnectState> {
  const admin = await authorize("settings:manage");
  const e = env();
  if (!isSupabase() || !hasSupabaseAdmin()) return { error: "A conexão exige o Supabase e a SUPABASE_SECRET_KEY no servidor." };
  if (!e.META_APP_ID || !e.WHATSAPP_APP_SECRET || !e.WHATSAPP_TOKEN_KEY) {
    return { error: "Faltam META_APP_ID, WHATSAPP_APP_SECRET ou WHATSAPP_TOKEN_KEY no servidor." };
  }
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados da Meta inválidos. Tente conectar novamente." };
  const v = parsed.data;
  if (v.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
    await audit({ orgId: admin.orgId, userId: admin.id, action: "whatsapp.conexao_recusada", entity: "whatsapp", entityId: v.phoneNumberId, details: `evento ${v.event}`, ip: await clientIp() });
    return { error: "A Meta não concluiu o fluxo de coexistência (app WhatsApp Business). Nada foi salvo e o número não foi alterado." };
  }

  let token: string;
  try {
    token = await exchangeCode(v.code);
  } catch (err) {
    return { error: `A Meta recusou a conexão: ${err instanceof Error ? err.message : "erro"}` };
  }

  let info: PhoneInfo;
  try {
    info = await phoneInfo(v.phoneNumberId, token);
  } catch (err) {
    return { error: `Não foi possível conferir o número: ${err instanceof Error ? err.message : "erro"}` };
  }
  if (info.is_on_biz_app === false) {
    return { error: "A Meta informou que este número NÃO está em coexistência com o app. Por segurança, a conexão não foi concluída." };
  }

  const db = supabaseAdmin();
  const { data: other } = await db.from("whatsapp_accounts").select("org_id").eq("phone_number_id", v.phoneNumberId).maybeSingle();
  if (other && other.org_id !== admin.orgId) return { error: "Este número já está conectado a outra organização." };

  // Recebimento dos webhooks desta conta pelo app da Ponto Digital.
  try {
    await graph(`${v.wabaId}/subscribed_apps`, token, { method: "POST" });
  } catch (err) {
    return { error: `Não foi possível assinar os webhooks da conta: ${err instanceof Error ? err.message : "erro"}` };
  }

  const now = new Date().toISOString();
  const { error: saveErr } = await db.from("whatsapp_accounts").upsert(
    {
      org_id: admin.orgId,
      phone_number_id: v.phoneNumberId,
      waba_id: v.wabaId,
      display_phone: (info.display_phone_number ?? "").slice(0, 40),
      verified_name: (info.verified_name ?? "").slice(0, 120),
      coexistence: true,
      token_ciphertext: encryptSecret(token, e.WHATSAPP_TOKEN_KEY),
      onboarded_by: admin.id,
      onboarded_at: now,
      updated_at: now,
    },
    { onConflict: "org_id" },
  );
  if (saveErr) return { error: "Conexão feita na Meta, mas não foi possível salvar no CRM. Tente novamente." };
  await db.from("organizations").update({ wa_phone_number_id: v.phoneNumberId }).eq("id", admin.orgId);

  // A Meta dá 24h para pedir a sincronização: pedimos na hora (contatos primeiro, depois histórico).
  const contactsErr = await requestSync(v.phoneNumberId, token, "smb_app_state_sync");
  const historyErr = await requestSync(v.phoneNumberId, token, "history");
  await db
    .from("whatsapp_accounts")
    .update({
      contacts_sync_requested_at: contactsErr ? null : now,
      history_sync_requested_at: historyErr ? null : now,
      last_error: [contactsErr && `contatos: ${contactsErr}`, historyErr && `histórico: ${historyErr}`].filter(Boolean).join("; ").slice(0, 500) || null,
    })
    .eq("org_id", admin.orgId);

  await audit({
    orgId: admin.orgId,
    userId: admin.id,
    action: "whatsapp.coexistencia_conectada",
    entity: "whatsapp",
    entityId: v.phoneNumberId,
    details: `${info.display_phone_number ?? ""} (${info.verified_name ?? ""}); sincronização ${contactsErr || historyErr ? "com pendências" : "solicitada"}`,
    ip: await clientIp(),
  });
  revalidatePath("/configuracoes/whatsapp");
  return { ok: `WhatsApp ${info.display_phone_number ?? ""} conectado em coexistência. O app no celular continua funcionando normalmente.` };
}

/** Repete o pedido de sincronização (só funciona dentro das 24h da conexão e uma vez por tipo). */
export async function retrySyncAction(_: ConnectState, formData: FormData): Promise<ConnectState> {
  const admin = await authorize("settings:manage");
  if (!hasSupabaseAdmin()) return { error: "Exige a SUPABASE_SECRET_KEY no servidor." };
  const type = formData.get("type") === "history" ? "history" : "smb_app_state_sync";
  const creds = await waCredentials(admin.orgId);
  if (!creds) return { error: "WhatsApp não conectado." };
  const err = await requestSync(creds.phoneNumberId, creds.token, type);
  if (err) return { error: `A Meta recusou: ${err}` };
  await supabaseAdmin()
    .from("whatsapp_accounts")
    .update(type === "history" ? { history_sync_requested_at: new Date().toISOString() } : { contacts_sync_requested_at: new Date().toISOString() })
    .eq("org_id", admin.orgId);
  await audit({ orgId: admin.orgId, userId: admin.id, action: "whatsapp.sincronizacao_solicitada", entity: "whatsapp", entityId: creds.phoneNumberId, details: type, ip: await clientIp() });
  revalidatePath("/configuracoes/whatsapp");
  return { ok: "Sincronização solicitada. Os dados chegam pelo webhook em alguns minutos." };
}

/**
 * Vincula à organização o número configurado nas variáveis do servidor (alternativa ao
 * Embedded Signup, por exemplo quando a conexão foi feita por um parceiro da Meta).
 * Só leitura na Meta: confere o número e o modo de coexistência, sem alterar nada.
 */
export async function linkEnvNumberAction(): Promise<ConnectState> {
  const admin = await authorize("settings:manage");
  const e = env();
  if (!hasSupabaseAdmin()) return { error: "Exige a SUPABASE_SECRET_KEY no servidor." };
  if (!e.WHATSAPP_PHONE_NUMBER_ID || !e.WHATSAPP_ACCESS_TOKEN) return { error: "Defina WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN no servidor." };
  let info: PhoneInfo;
  try {
    info = await phoneInfo(e.WHATSAPP_PHONE_NUMBER_ID, e.WHATSAPP_ACCESS_TOKEN);
  } catch (err) {
    return { error: `A Meta não confirmou o número: ${err instanceof Error ? err.message : "erro"}` };
  }
  const db = supabaseAdmin();
  const { error } = await db.from("organizations").update({ wa_phone_number_id: e.WHATSAPP_PHONE_NUMBER_ID }).eq("id", admin.orgId);
  if (error) return { error: error.code === "23505" ? "Este número já está vinculado a outra organização." : "Não foi possível vincular." };
  // Registro do número (sem token: as credenciais ficam nas variáveis do servidor).
  const now = new Date().toISOString();
  await db.from("whatsapp_accounts").upsert(
    {
      org_id: admin.orgId,
      phone_number_id: e.WHATSAPP_PHONE_NUMBER_ID,
      waba_id: e.WHATSAPP_WABA_ID ?? "",
      display_phone: (info.display_phone_number ?? "").slice(0, 40),
      verified_name: (info.verified_name ?? "").slice(0, 120),
      coexistence: info.is_on_biz_app === true,
      token_ciphertext: null,
      onboarded_by: admin.id,
      onboarded_at: now,
      updated_at: now,
    },
    { onConflict: "org_id" },
  );
  await audit({ orgId: admin.orgId, userId: admin.id, action: "whatsapp.numero_vinculado", entity: "whatsapp", entityId: e.WHATSAPP_PHONE_NUMBER_ID, details: `${info.display_phone_number ?? ""}; coexistência: ${info.is_on_biz_app ? "sim" : "não informado"}`, ip: await clientIp() });
  revalidatePath("/configuracoes/whatsapp");
  return { ok: `Número ${info.display_phone_number ?? ""} vinculado. ${info.is_on_biz_app ? "Coexistência com o app confirmada pela Meta." : "Atenção: a Meta não confirmou coexistência com o app para este número."}` };
}

const profileSchema = z.object({
  about: z.string().trim().min(1, "Escreva o recado.").max(139, "O recado tem no máximo 139 caracteres."),
  description: z.string().trim().max(512, "A descrição tem no máximo 512 caracteres."),
  vertical: z.enum(Object.keys(VERTICALS) as [string, ...string[]]),
  address: z.string().trim().max(256),
  email: z.union([z.literal(""), z.string().trim().email("E-mail inválido.").max(128)]),
  site1: z.union([z.literal(""), z.string().trim().url("Site inválido (comece com https://).").max(256)]),
  site2: z.union([z.literal(""), z.string().trim().url("Site inválido (comece com https://).").max(256)]),
});

/** Atualiza o perfil comercial do número oficial na Meta (foto, recado, descrição, categoria, endereço, sites). */
export async function updateProfileAction(_: ConnectState, formData: FormData): Promise<ConnectState> {
  const admin = await authorize("settings:manage");
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const creds = await waCredentials(admin.orgId);
  if (!creds) return { error: "Número oficial não configurado no servidor." };
  const p = parsed.data;
  let photo: { bytes: Buffer; mime: string } | "padrao" | null = formData.get("usarLogo") === "on" ? "padrao" : null;
  const file = formData.get("foto");
  if (file instanceof File && file.size > 0) {
    if (!["image/jpeg", "image/png"].includes(file.type)) return { error: "A foto precisa ser JPG ou PNG." };
    if (file.size > 5 * 1024 * 1024) return { error: "A foto pode ter até 5 MB." };
    photo = { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type };
  }
  try {
    await updateBusinessProfile(creds.phoneNumberId, creds.token, { about: p.about, description: p.description, vertical: p.vertical, address: p.address, email: p.email, websites: [p.site1, p.site2].filter(Boolean) }, photo);
  } catch (err) {
    return { error: `A Meta recusou: ${err instanceof Error ? err.message : "erro"}` };
  }
  await audit({ orgId: admin.orgId, userId: admin.id, action: "whatsapp.perfil_atualizado", entity: "whatsapp", entityId: creds.phoneNumberId, details: photo ? "com foto" : "sem foto", ip: await clientIp() });
  revalidatePath("/configuracoes/whatsapp");
  return { ok: "Perfil do WhatsApp atualizado." };
}
