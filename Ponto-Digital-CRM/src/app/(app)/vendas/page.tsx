import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { Badge, buttonClass, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";
import { PAYMENT_LABEL, SALE_STATUS_LABEL } from "@/lib/business/rules";
import { listAll } from "@/lib/data/collections";
import { scoped } from "@/lib/data/repo";
import type { Sale } from "@/lib/data/types";
import { formatDate, formatDateTime, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cancelSaleAction, createSaleAction, markPaidAction } from "./actions";

export const metadata = { title: "Vendas" };
export const instant = false;

const TONE = { aguardando_pagamento: "amber", pago: "green", cancelada: "slate" } as const;

export default async function VendasPage({ searchParams }: { searchParams: Promise<{ status?: string; cliente?: string; conversa?: string }> }) {
  const user = await requireUser("sales:manage");
  const sp = await searchParams;
  const finance = can(user.role, "finance:manage");
  const [sales, d] = await Promise.all([listAll(user.orgId, "sales", { order: "number", desc: true }), scoped(user.orgId)]);
  const clients = new Map(d.clients.map((c) => [c.id, c.name]));
  const list = sales.filter((s) => !sp.status || s.status === sp.status).filter((s) => !sp.cliente || s.clientId === sp.cliente);
  const open = sales.filter((s) => s.status === "aguardando_pagamento");

  const Row = ({ s }: { s: Sale }) => (
    <li className="space-y-2 px-5 py-4" data-sale={s.number}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-slate-500">#{s.number}</span>
        <Link href={`/clientes/${s.clientId}`} className="font-semibold hover:text-brand-700">{clients.get(s.clientId) ?? "Cliente"}</Link>
        <Badge tone={TONE[s.status]}>{SALE_STATUS_LABEL[s.status]}</Badge>
        <span className="ml-auto text-sm font-semibold tabular-nums">{money(s.totalCents)}</span>
      </div>
      <p className="text-sm text-slate-600">{s.items.map((i) => `${i.quantity}× ${i.description}`).join(" · ")}</p>
      <p className="text-xs text-slate-500">
        {PAYMENT_LABEL[s.paymentMethod]} · criada em {formatDateTime(s.createdAt)}
        {s.dueDate && <> · vencimento {formatDate(`${s.dueDate}T12:00:00Z`)}</>}
        {s.paidAt && <> · paga em {formatDate(s.paidAt)}</>}
        {s.conversationId && <> · <Link className="hover:text-brand-700" href={`/inbox/${s.conversationId}`}>conversa</Link></>}
      </p>
      {s.status !== "cancelada" && (s.status === "aguardando_pagamento" || finance) && (
        <div className="flex flex-wrap gap-2">
          {s.status === "aguardando_pagamento" && finance && (
            <details className="rounded-xl border border-line px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-emerald-700">Dar baixa manual</summary>
              <div className="pt-2">
                <p className="mb-2 text-xs text-slate-500">Use quando o pagamento já foi conferido no banco. Com comprovante, prefira o Financeiro.</p>
                <ActionForm action={markPaidAction} submitLabel="Confirmar pagamento" success="Pagamento registrado.">
                  <input type="hidden" name="id" value={s.id} />
                </ActionForm>
              </div>
            </details>
          )}
          <details className="rounded-xl border border-line px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-red-700">Cancelar venda</summary>
            <div className="pt-2">
              <ActionForm action={cancelSaleAction} submitLabel="Cancelar venda" success="Venda cancelada.">
                <input type="hidden" name="id" value={s.id} />
                <Field label="Motivo" htmlFor={`reason-${s.id}`}><Input id={`reason-${s.id}`} name="reason" required minLength={3} maxLength={300} /></Field>
              </ActionForm>
            </div>
          </details>
        </div>
      )}
    </li>
  );

  return (
    <>
      <PageHeader title="Vendas" description={`${open.length} aguardando pagamento · ${money(open.reduce((t, s) => t + s.totalCents, 0))} em aberto`} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/vendas" className={buttonClass(!sp.status ? "secondary" : "ghost", "sm")}>Todas</Link>
        {(Object.keys(SALE_STATUS_LABEL) as Sale["status"][]).map((k) => (
          <Link key={k} href={`/vendas?status=${k}`} className={buttonClass(sp.status === k ? "secondary" : "ghost", "sm")}>{SALE_STATUS_LABEL[k]}</Link>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          {list.length === 0 ? (
            <EmptyState icon={<ShoppingBag className="size-5" />} title="Nenhuma venda" description="Registre a venda ao fechar negócio no atendimento." />
          ) : (
            <ul className="divide-y divide-line">{list.map((s) => <Row key={s.id} s={s} />)}</ul>
          )}
        </Card>
        <Card className="xl:sticky xl:top-6 xl:self-start">
          <CardHeader title="Nova venda" description="Fica aguardando pagamento até o Financeiro confirmar." />
          <div className="p-5">
            <ActionForm action={createSaleAction} submitLabel="Registrar venda" success="Venda registrada.">
              <input type="hidden" name="conversationId" value={sp.conversa ?? ""} />
              <Field label="Cliente" htmlFor="clientId">
                <Select id="clientId" name="clientId" required defaultValue={sp.cliente ?? ""}>
                  <option value="">— Escolha —</option>
                  {[...d.clients].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Itens</legend>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="grid grid-cols-[1fr_56px_96px] gap-2">
                    <Input name="itemDescription" placeholder={i === 0 ? "Ex.: Identidade visual" : "Item (opcional)"} required={i === 0} maxLength={200} aria-label={`Descrição do item ${i + 1}`} />
                    <Input name="itemQuantity" type="number" min={1} max={10000} defaultValue={1} aria-label={`Quantidade do item ${i + 1}`} />
                    <Input name="itemPrice" inputMode="decimal" placeholder="R$" required={i === 0} aria-label={`Valor unitário do item ${i + 1}`} />
                  </div>
                ))}
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Pagamento" htmlFor="paymentMethod">
                  <Select id="paymentMethod" name="paymentMethod">{Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                </Field>
                <Field label="Vencimento" htmlFor="dueDate"><Input id="dueDate" name="dueDate" type="date" /></Field>
              </div>
              <Field label="Observações" htmlFor="notes"><Textarea id="notes" name="notes" rows={2} maxLength={2000} /></Field>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
