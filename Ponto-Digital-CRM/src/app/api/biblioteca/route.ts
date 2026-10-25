import { connection, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { uploadReceipt } from "@/lib/business/service";
import { audit } from "@/lib/data/repo";
import { env } from "@/lib/env";
import { saveAsset } from "@/lib/media/storage";
import { can } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";

const MAX_BODY = 51 * 1024 * 1024;

/**
 * Envio de arquivos: biblioteca de mídias (áudio, imagem, vídeo, PDF) ou comprovante de pagamento (Financeiro).
 * O tipo é conferido pelos primeiros bytes do arquivo, não só pela extensão.
 */
export async function POST(req: Request) {
  await connection();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const origin = req.headers.get("origin") ?? "";
  if (!URL.canParse(origin) || new URL(origin).host !== new URL(env().APP_URL).host) {
    return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  }
  if (!rateLimit(`upload:${user.id}`, 30, 60_000).ok) return NextResponse.json({ error: "Muitos envios seguidos. Aguarde um minuto." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "Arquivo muito grande (máx. 50 MB)." }, { status: 413 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Selecione um arquivo." }, { status: 400 });
  const destino = String(form?.get("destino") ?? "biblioteca");
  const clientId = String(form?.get("clientId") ?? "") || null;
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (destino === "comprovante") {
    if (!can(user.role, "finance:manage")) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    const r = await uploadReceipt(user, { bytes, mime: file.type, filename: file.name }, clientId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    revalidatePath("/financeiro");
    return NextResponse.json({ ok: true, id: r.value.id, redirect: `/financeiro/comprovantes/${r.value.id}` });
  }

  if (!can(user.role, "media:manage")) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const tags = String(form?.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const asset = await saveAsset({
    orgId: user.orgId,
    bytes,
    mime: file.type,
    filename: file.name,
    title: String(form?.get("title") ?? ""),
    tags,
    source: "upload",
    clientId,
    createdBy: user.id,
  });
  if ("error" in asset) return NextResponse.json({ error: asset.error }, { status: 400 });
  await audit({ orgId: user.orgId, userId: user.id, action: "biblioteca.arquivo_enviado", entity: "midia", entityId: asset.id, details: `${asset.type}: ${asset.title}` });
  revalidatePath("/biblioteca");
  return NextResponse.json({ ok: true, id: asset.id });
}
