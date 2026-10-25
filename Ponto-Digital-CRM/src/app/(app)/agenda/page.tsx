import Link from "next/link";
import { CalendarCheck, Check, Handshake, Phone, Send, Trash2, Undo2, Users } from "lucide-react";
import { Badge, buttonClass, Card, CardHeader, cn, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import type { Task, TaskType } from "@/lib/data/types";
import { formatTime, localDay, requestTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { createTaskAction, deleteTaskAction, toggleTaskAction } from "./actions";

export const metadata = { title: "Agenda" };
export const instant = false;

const TYPES: Record<TaskType, { label: string; icon: typeof Phone }> = {
  retorno: { label: "Retorno", icon: Undo2 },
  ligacao: { label: "Ligação", icon: Phone },
  reuniao: { label: "Reunião", icon: Users },
  proposta: { label: "Proposta", icon: Send },
  outro: { label: "Tarefa", icon: Handshake },
};

const dayLabel = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" });

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ ver?: string; cliente?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const d = await scoped(user.orgId);
  const manageAll = can(user.role, "tasks:manage_all");
  const all = manageAll && sp.ver !== "minhas";
  const clients = new Map(d.clients.map((c) => [c.id, c.name]));
  const users = new Map(d.users.map((u) => [u.id, u.name]));

  const nowMs = requestTime();
  const today = localDay(new Date(nowMs));
  const tomorrow = localDay(new Date(nowMs + 86400_000));
  const tasks = d.tasks
    .filter((t) => (all ? true : t.assigneeId === user.id))
    .filter((t) => !sp.cliente || t.clientId === sp.cliente)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const pending = tasks.filter((t) => !t.done);
  const overdue = pending.filter((t) => new Date(t.dueAt).getTime() < nowMs);
  const upcoming = pending.filter((t) => new Date(t.dueAt).getTime() >= nowMs);
  const groups = new Map<string, Task[]>();
  for (const t of upcoming) {
    const k = localDay(t.dueAt);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const done = tasks.filter((t) => t.done).slice(-8).reverse();
  const label = (k: string) => {
    if (k === today) return "Hoje";
    if (k === tomorrow) return "Amanhã";
    const s = dayLabel.format(new Date(`${k}T12:00:00-03:00`));
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const Row = ({ t }: { t: Task }) => {
    const T = TYPES[t.type];
    const late = !t.done && new Date(t.dueAt).getTime() < nowMs;
    return (
      <li className="flex items-center gap-3 px-5 py-3">
        <form action={toggleTaskAction}>
          <input type="hidden" name="id" value={t.id} />
          <button
            className={cn("flex size-6 items-center justify-center rounded-full border-2 transition-colors", t.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 hover:border-brand-500")}
            aria-label={t.done ? "Reabrir tarefa" : "Concluir tarefa"}
          >
            {t.done && <Check className="size-3.5" />}
          </button>
        </form>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", late ? "bg-red-50 text-red-600" : "bg-brand-50 text-brand-600")}>
          <T.icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", t.done && "text-slate-400 line-through")}>{t.title}</p>
          <p className="truncate text-xs text-slate-500">
            {T.label}
            {t.clientId && <> · <Link href={`/clientes/${t.clientId}`} className="hover:text-brand-700">{clients.get(t.clientId)}</Link></>}
            {all && t.assigneeId && <> · {users.get(t.assigneeId)}</>}
          </p>
        </div>
        <span className={cn("whitespace-nowrap text-xs tabular-nums", late ? "font-semibold text-red-600" : "text-slate-500")}>
          {late ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(t.dueAt)) : formatTime(t.dueAt)}
        </span>
        <form action={deleteTaskAction}>
          <input type="hidden" name="id" value={t.id} />
          <button className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600" aria-label="Excluir tarefa"><Trash2 className="size-4" /></button>
        </form>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Agenda comercial"
        description={`${overdue.length} atrasada(s) · ${upcoming.length} próxima(s)`}
        actions={
          manageAll && (
            <div className="flex rounded-xl border border-line bg-white p-1">
              <Link href="/agenda" className={buttonClass(all ? "secondary" : "ghost", "sm")}>Equipe</Link>
              <Link href="/agenda?ver=minhas" className={buttonClass(all ? "ghost" : "secondary", "sm")}>Minhas</Link>
            </div>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {overdue.length > 0 && (
            <Card className="border-red-200">
              <CardHeader title={<span className="text-red-700">Atrasadas</span>} action={<Badge tone="red">{overdue.length}</Badge>} />
              <ul className="divide-y divide-line">{overdue.map((t) => <Row key={t.id} t={t} />)}</ul>
            </Card>
          )}
          {[...groups.entries()].map(([k, list]) => (
            <Card key={k}>
              <CardHeader title={label(k)} action={<Badge>{list.length}</Badge>} />
              <ul className="divide-y divide-line">{list.map((t) => <Row key={t.id} t={t} />)}</ul>
            </Card>
          ))}
          {pending.length === 0 && (
            <Card><EmptyState icon={<CalendarCheck className="size-5" />} title="Tudo em dia!" description="Nenhum retorno ou tarefa pendente." /></Card>
          )}
          {done.length > 0 && (
            <Card>
              <CardHeader title="Concluídas recentemente" />
              <ul className="divide-y divide-line">{done.map((t) => <Row key={t.id} t={t} />)}</ul>
            </Card>
          )}
        </div>

        <Card className="xl:sticky xl:top-6 xl:self-start">
          <CardHeader title="Novo retorno ou tarefa" />
          <div className="p-5">
            <ActionForm action={createTaskAction} submitLabel="Agendar" success="Tarefa agendada.">
              <Field label="Título" htmlFor="title"><Input id="title" name="title" required placeholder="Ex.: Retornar sobre proposta" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tipo" htmlFor="type">
                  <Select id="type" name="type">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
                </Field>
                <Field label="Data e hora" htmlFor="dueAt"><Input id="dueAt" name="dueAt" type="datetime-local" required /></Field>
              </div>
              <Field label="Cliente" htmlFor="clientId">
                <Select id="clientId" name="clientId" defaultValue={sp.cliente ?? ""}>
                  <option value="">— Nenhum —</option>
                  {[...d.clients].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              {manageAll && (
                <Field label="Responsável" htmlFor="assigneeId">
                  <Select id="assigneeId" name="assigneeId" defaultValue={user.id}>
                    {d.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Observações" htmlFor="notes"><Textarea id="notes" name="notes" rows={2} /></Field>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
