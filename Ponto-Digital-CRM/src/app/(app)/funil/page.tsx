import Link from "next/link";
import { buttonClass, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { Board } from "./board";

export const metadata = { title: "Funil comercial" };
export const instant = false;

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ dono?: string }> }) {
  const user = await requireUser();
  const { dono } = await searchParams;
  const d = await scoped(user.orgId);
  const clients = new Map(d.clients.map((c) => [c.id, c.name]));
  const users = new Map(d.users.map((u) => [u.id, u.name]));
  const mine = dono === "eu";
  const deals = d.deals
    .filter((x) => clients.has(x.clientId) && (!mine || x.ownerId === user.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((x) => ({
      id: x.id,
      title: x.title,
      valueCents: x.valueCents,
      stage: x.stage,
      clientId: x.clientId,
      clientName: clients.get(x.clientId)!,
      ownerName: x.ownerId ? users.get(x.ownerId) ?? null : null,
      updatedAt: x.updatedAt,
    }));
  const open = deals.filter((x) => !["fechado", "perdido"].includes(x.stage)).reduce((s, x) => s + x.valueCents, 0);

  return (
    <>
      <PageHeader
        title="Funil comercial"
        description={`${money(open)} em negociação · arraste os cartões entre as etapas`}
        actions={
          <div className="flex rounded-xl border border-line bg-white p-1 text-sm">
            <Link href="/funil" className={buttonClass(mine ? "ghost" : "secondary", "sm")}>Todos</Link>
            <Link href="/funil?dono=eu" className={buttonClass(mine ? "secondary" : "ghost", "sm")}>Meus</Link>
          </div>
        }
      />
      <Board
        deals={deals}
        canEdit={can(user.role, "deals:write")}
        clients={d.clients.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))}
      />
    </>
  );
}
