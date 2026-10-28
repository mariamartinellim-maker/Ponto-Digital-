import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { graph, GraphError } from "./graph";

/**
 * Perfil comercial do número oficial (foto, recado, descrição, categoria, endereço e sites), pela Cloud API.
 * A Meta não oferece pela API capa nem horário de atendimento: esses ficam só no app WhatsApp Business.
 */
export interface BusinessProfile {
  about: string;
  description: string;
  vertical: string;
  address: string;
  email: string;
  websites: string[];
}

/** Categorias aceitas pela Meta (campo "vertical"), com o nome que aparece na tela. */
export const VERTICALS: Record<string, string> = {
  PROF_SERVICES: "Serviços profissionais",
  OTHER: "Outro",
  AUTO: "Automotivo",
  EDU: "Educação",
  ENTERTAIN: "Entretenimento",
  EVENT_PLAN: "Eventos",
  RETAIL: "Varejo",
  TRAVEL: "Viagens e transporte",
};

/** Perfil sugerido para a Ponto Digital (pedido do dono em 28/10/2026). */
export const PROFILE_DEFAULTS: BusinessProfile = {
  about: "Agência de Marketing e Criativos · Atendimento 24 horas",
  description:
    "Agência de marketing e criativos em Cuiabá-MT. Criamos vídeos com avatar animado para motoristas de todos os segmentos (aplicativo, táxi, mototáxi, entregas, van, executivo e frete), artes, anúncios e conteúdo para redes sociais. Atendimento 24 horas pelo WhatsApp.",
  vertical: "PROF_SERVICES",
  address: "Cuiabá - MT",
  email: "",
  websites: ["https://www.instagram.com/ponto_digital360"],
};

export const PROFILE_PHOTO = path.join(process.cwd(), "assets", "whatsapp", "foto-perfil.jpg");

const FIELDS = "about,address,description,email,profile_picture_url,websites,vertical";

export async function getBusinessProfile(phoneNumberId: string, token: string) {
  const r = await graph<{ data?: (Partial<BusinessProfile> & { profile_picture_url?: string })[] }>(`${phoneNumberId}/whatsapp_business_profile`, token, {
    query: { fields: FIELDS },
  });
  return r.data?.[0] ?? null;
}

/** Envia a imagem pela Resumable Upload API da Meta e devolve o "handle" usado na foto de perfil. */
async function uploadHandle(token: string, bytes: Buffer, mime: string): Promise<string> {
  const e = env();
  const appId = e.META_APP_ID ?? (await graph<{ id: string }>("app", token)).id;
  const session = await graph<{ id: string }>(`${appId}/uploads`, token, {
    method: "POST",
    query: { file_name: "foto-perfil.jpg", file_length: String(bytes.length), file_type: mime },
  });
  const url = `${e.WHATSAPP_GRAPH_BASE.replace(/\/+$/, "")}/${e.WHATSAPP_GRAPH_VERSION}/${session.id}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_offset: "0", "Content-Type": "application/octet-stream" },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { h?: string; error?: { message?: string; code?: number } };
  if (!res.ok || !body.h) throw new GraphError(body.error?.message ?? `Erro HTTP ${res.status} ao enviar a foto`, res.status, body.error?.code);
  return body.h;
}

export async function updateBusinessProfile(phoneNumberId: string, token: string, p: BusinessProfile, photo?: { bytes: Buffer; mime: string } | "padrao" | null) {
  const json: Record<string, unknown> = {
    messaging_product: "whatsapp",
    about: p.about,
    description: p.description,
    vertical: p.vertical,
    address: p.address,
    websites: p.websites.filter(Boolean).slice(0, 2),
  };
  if (p.email) json.email = p.email;
  if (photo) {
    const file = photo === "padrao" ? { bytes: await readFile(PROFILE_PHOTO), mime: "image/jpeg" } : photo;
    json.profile_picture_handle = await uploadHandle(token, file.bytes, file.mime);
  }
  await graph(`${phoneNumberId}/whatsapp_business_profile`, token, { json, timeoutMs: 30_000 });
}
