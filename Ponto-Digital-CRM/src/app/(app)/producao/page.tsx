import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Factory, X } from "lucide-react";
import { Badge, Card, CardHeader, cn, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";
import { PRODUCTION_STAGES, STAGE_LABEL } from "@/lib/business/rules";
import { listAll } from "@/lib/data/collections";
import { scoped } from "@/lib/data/repo";
import type { ProductionOrder, ProductionStage } from "@/lib/data/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { assignProductionAction, createProductionAction, moveProductionAction, toggleChecklistAction } from "./actions";

export const metadata = { title: "Produção" };
export const instant = false;

const FLOW: ProductionStage[] = ["fila", "producao", "revisao", "entregue"];

export default async function ProducaoPage() {
  const user = await requireUser("production:manage");
  const [orders, d] = await Promise.all([listAll(user.orgId, "productionOrders", { order: "updatedAt", desc: true }), scoped(user.orgId)]);
  const clients = new Map(d.clients.map((c) => [c.id, c.name]));
  const team = d.users.filter((u) => u.active);
  const canCancel = user.role !== "atendente";
  const finished = orders.filter((o) => o.stage === "entregue" || o.stage === "cancelada").slice(0, 15);

  const OrderCard = ({ o }: { o: ProductionOrder }) => {
    const i = FLOW.indexOf(o.stage);
    const done = o.checklist.filter((c) => c.done).length;
    const move = (to: ProductionStage, label: string, icon: React.ReactNode, cls = "") => (
      <form action={moveProductionAction}>
        <input type="hidden" name="id" value={o.id} />
        <input type="hidden" name="to" value={to} />
        <button className={cn("flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium hover:bg-slate-50", cls)} aria-label={`${label} — ordem ${o.number}`}>{icon}{label}</button>
      </form>
    );
    return (
      <li data-order={o.number}>
        <Card className="space-y-3 p-4">
          <div>
            <p className="font-mono text-[11px] text-slate-400">#{o.number}{o.saleId && " · da venda"}</p>
            <p className="text-sm font-semibold">{o.title}</p>
            <p className="text-xs text-slate-500">
              <Link href={`/clientes/${o.clientId}`} className="hover:text-brand-700">{clients.get(o.clientId) ?? "Cliente"}</Link>
              {o.dueDate && <> · prazo {formatDate(`${o.dueDate}T12:00:00Z`)}</>}
            </p>
          </div>
          {o.checklist.length > 0 && (
            <ul className="space-y-1">
              <li className="text-[11px] font-medium text-slate-500">Checklist {done}/{o.checklist.length}</li>
              {o.checklist.map((c, idx) => (
                <li key={idx}>
                  <form action={toggleChecklistAction} className="flex">
                    <input type="hidden" name="id" value={o.id} />
                    <input type="hidden" name="index" value={idx} />
                    <button className="flex items-center gap-2 text-left text-[13px]" aria-label={`${c.done ? "Desmarcar" : "Concluir"}: ${c.description}`}>
                      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", c.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300")}>{c.done && <Check className="size-3" />}</span>
                      <span className={cn(c.done && "text-slate-400 line-through")}>{c.description}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={assignProductionAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={o.id} />
            <Select name="assigneeId" defaultValue={o.assigneeId ?? ""} aria-label={`Responsável pela ordem ${o.number}`} className="h-8 py-0 text-xs">
              <option value="">Sem responsável</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            <button className="rounded-lg border border-line px-2 py-1 text-xs font-medium hover:bg-slate-50">Salvar</button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {i > 0 && move(FLOW[i - 1]!, "Voltar", <ChevronLeft className="size-3.5" />)}
            {i < FLOW.length - 1 && move(FLOW[i + 1]!, FLOW[i + 1] === "entregue" ? "Entregar" : "Avançar", <ChevronRight className="size-3.5" />, "border-brand-200 text-brand-700")}
            {canCancel && move("cancelada", "Cancelar", <X className="size-3.5" />, "text-red-600")}
          </div>
        </Card>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Produção" description="Ordens criadas automaticamente quando o pagamento é confirmado." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {PRODUCTION_STAGES.filter((s) => s.id !== "entregue" && s.id !== "cancelada").map((s) => {
          const list = orders.filter((o) => o.stage === s.id);
          return (
            <section key={s.id} aria-label={s.label} className="rounded-2xl bg-slate-50 p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold">{s.label} <Badge>{list.length}</Badge></h2>
              {list.length === 0 ? <p className="px-1 py-6 text-center text-xs text-slate-400">Vazio</p> : <ul className="space-y-3">{list.map((o) => <OrderCard key={o.id} o={o} />)}</ul>}
            </section>
          );
        })}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Encerradas recentemente" />
          {finished.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500"><Factory className="mr-1 inline size-4" /> Nenhuma ordem encerrada ainda.</p>
          ) : (
            <ul className="divide-y divide-line">
              {finished.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-5 py-3 text-sm" data-order={o.number}>
                  <span className="font-mono text-xs text-slate-400">#{o.number}</span>
                  <span className="flex-1 truncate">{o.title}</span>
                  <Badge tone={o.stage === "entregue" ? "green" : "slate"}>{STAGE_LABEL[o.stage]}</Badge>
                  <span className="text-xs text-slate-500">{formatDateTime(o.deliveredAt ?? o.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="xl:self-start">
          <CardHeader title="Ordem avulsa" description="Sem venda vinculada (retrabalho, cortesia…)." />
          <div className="p-5">
            <ActionForm action={createProductionAction} submitLabel="Criar ordem" success="Ordem criada.">
              <Field label="Cliente" htmlFor="clientId">
                <Select id="clientId" name="clientId" required>
                  <option value="">— Escolha —</option>
                  {[...d.clients].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Título" htmlFor="title"><Input id="title" name="title" required maxLength={200} /></Field>
              <Field label="Checklist" htmlFor="checklist" hint="Um item por linha"><Textarea id="checklist" name="checklist" rows={3} /></Field>
              <Field label="Prazo" htmlFor="dueDate"><Input id="dueDate" name="dueDate" type="date" /></Field>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
