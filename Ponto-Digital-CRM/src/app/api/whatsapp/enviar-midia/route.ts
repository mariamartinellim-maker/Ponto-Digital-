import { connection, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { audit } from "@/lib/data/repo";
import type { MessageMedia } from "@/lib/data/types";
import { env } from "@/lib/env";
import { windowOpen } from "@/lib/inbox";
import { loadTarget, recordOutgoing } from "@/lib/inbox-send";
import { can } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { sendDecision, sendWhatsApp, waCredentials } from "@/lib/whatsapp/client";
import { GraphError, uploadMedia } from "@/lib/whatsapp/graph";
import { classifyMedia } from "@/lib/whatsapp/guard";

const MAX_BODY = 17 * 1024 * 1024;
const LABEL = { image: "imagem", audio: "áudio", video: "vídeo", document: "documento" } as const;

/** Envio de imagem, áudio, vídeo ou documento numa conversa (dentro da janela de 24h). */
export async function POST(req: Request) {
  await connection();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!can(user.role, "inbox:reply")) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  // Proteção contra envio a partir de outros sites (CSRF): só aceita a origem do próprio CRM.
  const origin = req.headers.get("origin") ?? "";
  if (!URL.canParse(origin) || new URL(origin).host !== new URL(env().APP_URL).host) {
    return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  }
  if (!rateLimit(`midia-envio:${user.id}`, 20, 60_000).ok) return NextResponse.json({ error: "Muitos envios seguidos. Aguarde um minuto." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "Arquivo muito grande (máx. 16 MB)." }, { status: 413 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const conversationId = String(form?.get("conversationId") ?? "");
  const caption = String(form?.get("caption") ?? "").trim().slice(0, 1024);
  if (!(file instanceof File)) return NextResponse.json({ error: "Selecione um arquivo." }, { status: 400 });
  const kind = classifyMedia(file.type, file.size);
  if ("error" in kind) return NextResponse.json({ error: kind.error }, { status: 400 });

  let target;
  try {
    target = await loadTarget(user, conversationId);
  } catch {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }
  if (!windowOpen(target.conv)) {
    return NextResponse.json({ error: "Fora da janela de 24h. Use um modelo aprovado para retomar a conversa." }, { status: 400 });
  }

  const filename = file.name.replace(/[\r\n"\\/]/g, "_").slice(0, 200) || "arquivo";
  const media: MessageMedia = { type: kind.type, mime: file.type, filename, ...(caption ? { caption } : {}) };
  const decision = sendDecision(target.phone);
  if (decision.mode === "blocked") return NextResponse.json({ error: decision.reason }, { status: 400 });

  let simulated = true;
  let waMessageId = "";
  if (decision.mode === "live") {
    const creds = await waCredentials(user.orgId);
    if (!creds) return NextResponse.json({ error: "Credenciais da Cloud API não configuradas." }, { status: 503 });
    try {
      media.id = await uploadMedia(creds.phoneNumberId, creds.token, file, filename);
    } catch (err) {
      return NextResponse.json({ error: `Falha ao enviar o arquivo à Meta: ${err instanceof GraphError ? err.message : "erro de conexão"}` }, { status: 502 });
    }
    const r = await sendWhatsApp({ type: "media", to: target.phone, media: kind.type, mediaId: media.id, caption, filename }, { orgId: user.orgId });
    if (!r.ok) return NextResponse.json({ error: `Falha no envio: ${r.error}` }, { status: 502 });
    simulated = r.simulated;
    waMessageId = r.waMessageId;
  } else {
    const r = await sendWhatsApp({ type: "media", to: target.phone, media: kind.type, mediaId: "SIMULADO", caption, filename });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    waMessageId = r.waMessageId;
    media.simulated = true;
  }

  const body = `[${LABEL[kind.type]}] ${caption || filename}`.slice(0, 4096);
  const err = await recordOutgoing(user, target.conv, body, simulated, waMessageId, { media });
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  if (!simulated) {
    await audit({ orgId: user.orgId, userId: user.id, action: "whatsapp.midia_enviada", entity: "conversa", entityId: conversationId, details: `${LABEL[kind.type]}: ${filename}` });
  }
  revalidatePath(`/inbox/${conversationId}`);
  return NextResponse.json({ ok: true, simulated });
}
