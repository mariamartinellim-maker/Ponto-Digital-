import { connection, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { wawebConfig, wawebState } from "@/lib/whatsapp-web/manager";

/** Situação da conexão experimental do WhatsApp Web (consultada pela tela a cada poucos segundos). */
export async function GET() {
  await connection();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(user.role, "settings:manage")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const s = wawebState();
  const mine = !s.orgId || s.orgId === user.orgId;
  const cfg = wawebConfig();
  const qr = mine && s.qr ? await QRCode.toDataURL(s.qr, { margin: 1, width: 264, errorCorrectionLevel: "M" }) : null;
  return NextResponse.json(
    {
      status: mine ? s.status : "desligado",
      qr,
      phoneEnd: mine && s.phone ? s.phone.slice(-4) : null,
      lastError: mine ? s.lastError : null,
      updatedAt: s.updatedAt,
      connectedAt: mine ? s.connectedAt : null,
      received: mine ? s.received : 0,
      ignored: mine ? s.ignored : 0,
      simulator: cfg.simulator,
      ready: cfg.ready,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
