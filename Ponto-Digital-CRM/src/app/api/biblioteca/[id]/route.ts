import { connection, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getOne } from "@/lib/data/collections";
import { getFile } from "@/lib/media/storage";
import { can } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";

/** Arquivo da biblioteca, servido só para usuários da organização (comprovantes: só o Financeiro). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(user.role, "media:read") && !can(user.role, "inbox:reply")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (!rateLimit(`biblioteca:${user.id}`, 240, 60_000).ok) return NextResponse.json({ error: "Muitas requisições" }, { status: 429 });
  const { id } = await params;
  const asset = await getOne(user.orgId, "mediaAssets", id);
  if (!asset) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  if (asset.tags.includes("comprovante") && !can(user.role, "finance:manage")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const file = await getFile(asset.storageKey);
  if (!file) return NextResponse.json({ error: "Arquivo indisponível." }, { status: 404 });
  const download = new URL(req.url).searchParams.get("baixar") === "1";
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": download ? "application/octet-stream" : asset.mime,
      "Content-Length": String(file.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
    },
  });
}
