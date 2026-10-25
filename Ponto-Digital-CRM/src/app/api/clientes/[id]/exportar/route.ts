import { NextResponse } from "next/server";
import { clientIp, getSessionUser } from "@/lib/auth/session";
import { audit, scoped } from "@/lib/data/repo";
import { can } from "@/lib/permissions";

/** LGPD — direito de acesso/portabilidade: exporta todos os dados do titular em JSON. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(user.role, "clients:export")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const d = await scoped(user.orgId);
  const client = d.clients.find((c) => c.id === id);
  if (!client) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  const convIds = new Set(d.conversations.filter((c) => c.clientId === id).map((c) => c.id));
  const payload = {
    exportadoEm: new Date().toISOString(),
    controlador: user.orgName,
    titular: client,
    consentimentos: d.consentEvents.filter((e) => e.clientId === id),
    oportunidades: d.deals.filter((x) => x.clientId === id),
    tarefas: d.tasks.filter((t) => t.clientId === id),
    mensagens: d.messages
      .filter((m) => convIds.has(m.conversationId))
      .map(({ direction, origin, body, status, createdAt }) => ({ direction, origin, body, status, createdAt })),
    campanhas: d.campaigns
      .filter((c) => c.recipients.some((r) => r.clientId === id))
      .map((c) => ({ nome: c.name, executadaEm: c.executedAt, status: c.recipients.find((r) => r.clientId === id)?.status })),
  };
  await audit({ orgId: user.orgId, userId: user.id, action: "lgpd.exportacao", entity: "cliente", entityId: id, ip: await clientIp() });
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dados-titular-${id.slice(0, 8)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
