import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, Clock, Receipt as ReceiptIcon, Wallet } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { StatCard } from "@/components/ui/stat-card";
import { UploadForm } from "@/components/ui/upload-form";
import { requireUser } from "@/lib/auth/session";
import { financeSummary, RECEIPT_STATUS } from "@/lib/business/rules";
import { listAll } from "@/lib/data/collections";
import { scoped } from "@/lib/data/repo";
import { formatDate, formatDateTime, localDay, money, requestTime } from "@/lib/format";
import { storageReady } from "@/lib/media/storage";
import { addEntryAction } from "./actions";

export const metadata = { title: "Financeiro" };
export const instant = false;

export default async function FinanceiroPage() {
  const user = await requireUser("finance:manage");
  const [entries, sales, receipts, d] = await Promise.all([
    listAll(user.orgId, "financeEntries", { order: "date", desc: true }),
    listAll(user.orgId, "sales"),
    listAll(user.orgId, "receipts", { order: "createdAt", desc: true }),
    scoped(user.orgId),
  ]);
  const today = localDay(new Date(requestTime()));
  const month = today.slice(0, 7);
  const s = financeSummary(entries, sales, month);
  const clients = new Map(d.clients.map((c) => [c.id, c.name]));
  const toReview = receipts.filter((r) => r.status === "pendente" || r.status === "duplicado");
  const reviewed = receipts.filter((r) => r.status === "confirmado" || r.status === "rejeitado").slice(0, 20);
  const ready = storageReady();

  const ReceiptRow = ({ r }: { r: (typeof receipts)[number] }) => (
    <li>
      <Link href={`/financeiro/comprovantes/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50" data-receipt={r.id}>
        <ReceiptIcon className="size-4 shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{r.data?.pagador ?? (r.clientId ? clients.get(r.clientId) : null) ?? "Comprovante"}</p>
          <p className="truncate text-xs text-slate-500">
            {formatDateTime(r.createdAt)} · {r.analyzer === "ia" ? "lido pela IA" : r.analyzer === "manual" ? "digitado" : "sem leitura automática"}
          </p>
        </div>
        <span className="text-sm font-semibold tabular-nums">{r.data?.valorCentavos ? money(r.data.valorCentavos) : "—"}</span>
        <Badge tone={RECEIPT_STATUS[r.status].tone}>{RECEIPT_STATUS[r.status].label}</Badge>
      </Link>
    </li>
  );

  return (
    <>
      <PageHeader title="Financeiro" description="Comprovantes, baixas de pagamento e lançamentos. Toda confirmação é feita por uma pessoa." />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Entradas no mês" value={money(s.inMonth)} icon={ArrowUpCircle} accent="green" />
        <StatCard label="Saídas no mês" value={money(s.outMonth)} icon={ArrowDownCircle} accent="coral" />
        <StatCard label="Saldo do mês" value={money(s.balanceMonth)} icon={Wallet} />
        <StatCard label="A receber" value={money(s.receivable)} hint={`${s.receivableCount} venda(s) aguardando pagamento`} icon={Clock} accent="sky" />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Comprovantes para conferir" action={<Badge tone={toReview.length ? "amber" : "slate"}>{toReview.length}</Badge>} />
            {toReview.length === 0 ? (
              <EmptyState icon={<ReceiptIcon className="size-5" />} title="Nada para conferir" description="Envie um comprovante ao lado. A IA lê os dados e você confirma." />
            ) : (
              <ul className="divide-y divide-line">{toReview.map((r) => <ReceiptRow key={r.id} r={r} />)}</ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Lançamentos" description="Lançamentos não são editados: correções viram estornos." />
            {entries.length === 0 ? (
              <EmptyState title="Nenhum lançamento" description="Pagamentos confirmados entram aqui automaticamente." />
            ) : (
              <ul className="divide-y divide-line">
                {entries.slice(0, 50).map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-3" data-entry={e.description}>
                    {e.kind === "entrada" ? <ArrowUpCircle className="size-4 text-emerald-600" /> : <ArrowDownCircle className="size-4 text-red-600" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{e.description}</p>
                      <p className="truncate text-xs text-slate-500">{e.category} · {formatDate(`${e.date}T12:00:00Z`)}{e.saleId && " · venda"}</p>
                    </div>
                    <span className={e.kind === "entrada" ? "text-sm font-semibold tabular-nums text-emerald-700" : "text-sm font-semibold tabular-nums text-red-700"}>
                      {e.kind === "entrada" ? "+" : "−"} {money(e.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {reviewed.length > 0 && (
            <Card>
              <CardHeader title="Comprovantes revisados" />
              <ul className="divide-y divide-line">{reviewed.map((r) => <ReceiptRow key={r.id} r={r} />)}</ul>
            </Card>
          )}
        </div>
        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader title="Enviar comprovante" description="Imagem (JPG, PNG, WEBP) ou PDF." />
            <div className="p-5">
              {!ready.ok ? (
                <p className="text-sm text-red-600">{ready.reason}</p>
              ) : (
                <UploadForm destino="comprovante" accept="image/jpeg,image/png,image/webp,application/pdf" submitLabel="Enviar e ler" success="Comprovante recebido.">
                  <Field label="Cliente (opcional)" htmlFor="clientId">
                    <Select id="clientId" name="clientId">
                      <option value="">— Identificar depois —</option>
                      {[...d.clients].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                </UploadForm>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Novo lançamento" />
            <div className="p-5">
              <ActionForm action={addEntryAction} submitLabel="Lançar" success="Lançamento registrado.">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Tipo" htmlFor="kind">
                    <Select id="kind" name="kind"><option value="entrada">Entrada</option><option value="saida">Saída</option></Select>
                  </Field>
                  <Field label="Data" htmlFor="date"><Input id="date" name="date" type="date" required defaultValue={today} /></Field>
                </div>
                <Field label="Descrição" htmlFor="description"><Input id="description" name="description" required maxLength={200} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Categoria" htmlFor="category"><Input id="category" name="category" required maxLength={60} placeholder="Ex.: Fornecedores" /></Field>
                  <Field label="Valor" htmlFor="amount"><Input id="amount" name="amount" required inputMode="decimal" placeholder="R$" /></Field>
                </div>
              </ActionForm>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
