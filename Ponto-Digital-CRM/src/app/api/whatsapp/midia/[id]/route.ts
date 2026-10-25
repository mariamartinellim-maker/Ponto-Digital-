import { connection, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import type { MessageMedia } from "@/lib/data/types";
import { rateLimit } from "@/lib/rate-limit";
import { isSupabase, supabaseServer } from "@/lib/supabase/server";
import { waCredentials } from "@/lib/whatsapp/client";
import { downloadMedia, GraphError, mediaInfo } from "@/lib/whatsapp/graph";

const MAX = 100 * 1024 * 1024;
// Tipos exibidos no navegador; os demais são baixados como anexo (nunca interpretados como página).
const INLINE = /^(image\/(jpeg|png|webp)|audio\/(ogg|mpeg|mp4|aac|amr)|video\/(mp4|3gpp)|application\/pdf)$/;

/**
 * Mídia de uma mensagem do WhatsApp. O arquivo fica na Meta (até 30 dias) e é baixado sob demanda,
 * com o token do servidor, somente para quem pode ver a conversa (RLS do banco). Nada fica em cache.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!rateLimit(`midia:${user.id}`, 120, 60_000).ok) return NextResponse.json({ error: "Muitas requisições" }, { status: 429 });
  if (!isSupabase()) return NextResponse.json({ error: "Mídias reais existem apenas com o WhatsApp conectado." }, { status: 404 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  const sb = await supabaseServer();
  const { data: msg } = await sb.from("messages").select("id,media").eq("id", id).maybeSingle();
  const media = (msg?.media ?? null) as MessageMedia | null;
  if (!media?.id) return NextResponse.json({ error: "Mídia indisponível." }, { status: 404 });

  const creds = await waCredentials(user.orgId);
  if (!creds) return NextResponse.json({ error: "WhatsApp não conectado." }, { status: 503 });
  try {
    const info = await mediaInfo(media.id, creds.token);
    if ((info.file_size ?? 0) > MAX) return NextResponse.json({ error: "Arquivo muito grande." }, { status: 413 });
    const file = await downloadMedia(info.url, creds.token);
    const mime = (info.mime_type || media.mime || "application/octet-stream").split(";")[0]!.trim().toLowerCase();
    const filename = (media.filename || `whatsapp-${id.slice(0, 8)}`).replace(/["\r\n\\/]/g, "_");
    const inline = INLINE.test(mime) && new URL(req.url).searchParams.get("baixar") !== "1";
    return new NextResponse(file.body, {
      headers: {
        "Content-Type": inline ? mime : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
      },
    });
  } catch (err) {
    // A Meta guarda a mídia por 30 dias; depois disso ela não pode mais ser baixada.
    const expired = err instanceof GraphError && (err.status === 404 || err.code === 100);
    return NextResponse.json({ error: expired ? "Mídia expirada na Meta (mais de 30 dias)." : "Não foi possível baixar a mídia." }, { status: expired ? 410 : 502 });
  }
}
