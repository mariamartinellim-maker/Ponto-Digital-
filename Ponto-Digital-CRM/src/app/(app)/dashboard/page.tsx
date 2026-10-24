import Link from "next/link";
import { CalendarClock, DollarSign, Megaphone, MessagesSquare, Users } from "lucide-react";
import { FunnelChart, SalesChart } from "@/components/charts/charts";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { StatCard } from "@/components/ui/stat-card";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { STAGES } from "@/lib/data/types";
import { formatDateTime, money, relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Dashboard" };
export const instant = false;

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default async function DashboardPage() {
  const user = await requireUser("dashboard:view");
  const d = await scoped(user.orgId);
  const now = new Date();
  const nowMs = now.getTime();
  const monthKey = (iso: string) => iso.slice(0, 7);
  const thisMonth = now.toISOString().slice(0, 7);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString().slice(0, 7);

  const won = d.deals.filter((x) => x.stage === "fechado" && x.closedAt);
  const salesThis = won.filter((x) => monthKey(x.closedAt!) === thisMonth).reduce((s, x) => s + x.valueCents, 0);
  const salesPrev = won.filter((x) => monthKey(x.closedAt!) === prev).reduce((s, x) => s + x.valueCents, 0);
  const lost = d.deals.filter((x) => x.stage === "perdido").length;
  const conversion = won.length + lost ? (won.length / (won.length + lost)) * 100 : 0;

  const months = Array.from({ length: 6 }, (_, i) => {
    const dt = new Date(now.getFullYear(), now.getMonth() - 5 + i, 15);
    const key = dt.toISOString().slice(0, 7);
    const rows = won.filter((x) => monthKey(x.closedAt!) === key);
    return { month: MONTHS[dt.getMonth()]!, value: rows.reduce((s, x) => s + x.valueCents, 0), deals: rows.length };
  });

  const funnel = STAGES.map((s) => {
    const rows = d.deals.filter((x) => x.stage === s.id);
    return { stage: s.label, count: rows.length, value: rows.reduce((a, x) => a + x.valueCents, 0) };
  });
  const pipeline = d.deals
    .filter((x) => ["novo_lead", "em_atendimento", "proposta_enviada"].includes(x.stage))
    .reduce((s, x) => s + x.valueCents, 0);

  const newClients30 = d.clients.filter((c) => nowMs - new Date(c.createdAt).getTime() < 30 * 86400_000).length;
  const openConvs = d.conversations.filter((c) => c.status !== "resolvida");
  const unread = openConvs.reduce((n, c) => n + c.unread, 0);
  const unassigned = openConvs.filter((c) => !c.assigneeId).length;

  const lastCampaign = d.campaigns.filter((c) => c.status === "concluida").sort((a, b) => (b.executedAt ?? "").localeCompare(a.executedAt ?? ""))[0];
  const readRate = lastCampaign?.recipients.length
    ? (lastCampaign.recipients.filter((r) => ["lida", "respondeu"].includes(r.status)).length / lastCampaign.recipients.length) * 100
    : null;

  const clientName = new Map(d.clients.map((c) => [c.id, c.name]));
  const userName = new Map(d.users.map((u) => [u.id, u.name]));
  const myTasks = d.tasks
    .filter((t) => !t.done && (can(user.role, "tasks:manage_all") || t.assigneeId === user.id))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, 6);
  const recentConvs = [...openConvs].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)).slice(0, 5);
  const lastMsg = new Map<string, string>();
  for (const m of d.messages) lastMsg.set(m.conversationId, m.body);

  const greeting = now.getHours() < 12 ? "Bom dia" : now.getHours() < 18 ? "Boa tarde" : "Boa noite";

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user.name.split(" ")[0]}`}
        description="Visão geral de clientes, atendimentos, vendas e campanhas da Ponto Digital."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Clientes" value={String(d.clients.length)} hint={`+${newClients30} nos últimos 30 dias`} icon={Users} />
        <StatCard
          label="Atendimentos abertos"
          value={String(openConvs.length)}
          hint={`${unread} não lidas · ${unassigned} sem responsável`}
          icon={MessagesSquare}
          accent="coral"
        />
        <StatCard
          label="Vendas no mês"
          value={money(salesThis)}
          trend={salesPrev ? ((salesThis - salesPrev) / salesPrev) * 100 : null}
          hint="vs. mês anterior"
          icon={DollarSign}
          accent="green"
        />
        <StatCard
          label="Campanhas"
          value={String(d.campaigns.filter((c) => c.status === "concluida").length)}
          hint={readRate != null ? `${readRate.toFixed(0)}% de leitura na última` : "Nenhuma executada"}
          icon={Megaphone}
          accent="sky"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Vendas fechadas" description="Últimos 6 meses" action={<Badge tone="green">Conversão {conversion.toFixed(0)}%</Badge>} />
          <div className="p-4 pt-5">
            <SalesChart data={months} />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Funil comercial"
            description={`${money(pipeline)} em negociação`}
            action={<Link href="/funil" className="text-[13px] font-medium text-brand-600 hover:text-brand-700">Abrir</Link>}
          />
          <div className="p-4 pt-5">
            <FunnelChart data={funnel} />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Próximos retornos e tarefas"
            action={<Link href="/agenda" className="text-[13px] font-medium text-brand-600 hover:text-brand-700">Ver agenda</Link>}
          />
          {myTasks.length === 0 ? (
            <EmptyState icon={<CalendarClock className="size-5" />} title="Nenhuma tarefa pendente" />
          ) : (
            <ul className="divide-y divide-line">
              {myTasks.map((t) => {
                const overdue = new Date(t.dueAt).getTime() < nowMs;
                return (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                    <span className={`size-2 shrink-0 rounded-full ${overdue ? "bg-red-500" : "bg-brand-400"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{t.title}</p>
                      <p className="truncate text-xs text-slate-500">
                        {t.clientId ? clientName.get(t.clientId) : "Sem cliente"} · {t.assigneeId ? userName.get(t.assigneeId) : "Sem responsável"}
                      </p>
                    </div>
                    <span className={`whitespace-nowrap text-xs ${overdue ? "font-medium text-red-600" : "text-slate-500"}`}>
                      {overdue ? "Atrasada · " : ""}
                      {formatDateTime(t.dueAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Conversas recentes"
            action={<Link href="/inbox" className="text-[13px] font-medium text-brand-600 hover:text-brand-700">Abrir caixa de entrada</Link>}
          />
          <ul className="divide-y divide-line">
            {recentConvs.map((c) => (
              <li key={c.id}>
                <Link href={`/inbox/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <Avatar name={clientName.get(c.clientId) ?? "?"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900">{clientName.get(c.clientId)}</p>
                      {c.unread > 0 && <span className="rounded-full bg-coral-500 px-1.5 text-[11px] font-semibold text-white">{c.unread}</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500">{lastMsg.get(c.id)}</p>
                  </div>
                  <span className="whitespace-nowrap text-xs text-slate-400">{relativeTime(c.lastMessageAt, nowMs)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
