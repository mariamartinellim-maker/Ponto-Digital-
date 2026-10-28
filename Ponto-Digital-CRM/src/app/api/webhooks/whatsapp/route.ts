import { timingSafeEqual } from "node:crypto";
import { after, connection, NextResponse, type NextRequest } from "next/server";
import { applyWhatsAppEvents } from "@/lib/data/repo";
import { getDb } from "@/lib/data/store";
import { env } from "@/lib/env";
import { hasSupabaseAdmin } from "@/lib/supabase/admin";
import { isSupabase } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { runAutopilot } from "@/lib/video/autopilot";
import { parseWebhook } from "@/lib/whatsapp/events";
import { ingestSupabase, orgResolver } from "@/lib/whatsapp/ingest";
import { verifyMetaSignature } from "@/lib/whatsapp/signature";

const MAX_BODY = 1024 * 1024; // 1 MB

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Handshake de verificação exigido pela Meta ao cadastrar o webhook. */
export async function GET(req: NextRequest) {
  await connection();
  const p = req.nextUrl.searchParams;
  const expected = env().WHATSAPP_VERIFY_TOKEN;
  if (p.get("hub.mode") === "subscribe" && expected && safeEqual(p.get("hub.verify_token") ?? "", expected)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Recebe eventos da WhatsApp Cloud API:
 *  - valida a assinatura HMAC (X-Hub-Signature-256) com o App Secret ANTES de ler o JSON;
 *  - recusa corpos grandes e excesso de requisições;
 *  - processa de forma idempotente e responde 200 rapidamente (a Meta reenvia em caso de erro).
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`webhook:${ip}`, 600, 60_000).ok) return new NextResponse("Too Many Requests", { status: 429 });

  const secret = env().WHATSAPP_APP_SECRET;
  if (!secret) return new NextResponse("Webhook não configurado", { status: 503 });
  // No Supabase, os eventos são gravados pelo servidor com a chave secreta (não há usuário logado).
  if (isSupabase() && !hasSupabaseAdmin()) return new NextResponse("Webhook não configurado (SUPABASE_SECRET_KEY)", { status: 503 });

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return new NextResponse("Payload Too Large", { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new NextResponse("Payload Too Large", { status: 413 });

  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    console.warn("[webhook] assinatura inválida recusada");
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const envelopes = parseWebhook(payload);
  if (isSupabase()) {
    try {
      const stats = await ingestSupabase(envelopes);
      // Atendimento automático dos vídeos: roda depois da resposta (a Meta não espera pelo robô).
      after(async () => runAutopilot(envelopes, await orgResolver()));
      return NextResponse.json({ received: true, ...stats });
    } catch {
      return new NextResponse("Erro ao processar", { status: 500 });
    }
  }
  // Modo demonstração: uma única organização.
  const expectedPhone = env().WHATSAPP_PHONE_NUMBER_ID;
  const accepted = envelopes.filter((e) => !expectedPhone || !e.phoneNumberId || e.phoneNumberId === expectedPhone);
  const db = await getDb();
  const orgId = db.organizations[0]!.id;
  const stats = await applyWhatsAppEvents(orgId, accepted);
  after(() => runAutopilot(accepted, () => orgId));
  return NextResponse.json({ received: true, ...stats });
}
