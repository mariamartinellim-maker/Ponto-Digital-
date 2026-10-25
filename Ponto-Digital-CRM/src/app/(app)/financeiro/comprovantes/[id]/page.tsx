import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Badge, buttonClass, Card, CardHeader, Field, Input, Notice, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";
import { matchSales, needsAttention, PAYMENT_LABEL, RECEIPT_STATUS } from "@/lib/business/rules";
import { getOne, listAll } from "@/lib/data/collections";
import { scoped } from "@/lib/data/repo";
import { formatDate, formatDateTime, money } from "@/lib/format";
import { confirmReceiptAction, reanalyzeReceiptAction, rejectReceiptAction, saveReceiptAction } from "../../actions";

export const metadata = { title: "Comprovante" };
export const instant = false;

const cents = (v: number | null | undefined) => (v ? (v / 100).toFixed(2).replace(".", ",") : "");

export default async function ComprovantePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("finance:manage");
  const { id } = await params;
  const receipt = await getOne(user.orgId, "receipts", id);
  if (!receipt) notFound();
  const [asset, sales, d] = await Promise.all([getOne(user.orgId, "mediaAssets", receipt.mediaId), listAll(user.orgId, "sales"), scoped(user.orgId)]);
  const clients = new Map(d.clients.map((c) => [c.id, c.name]));
  const users = new Map(d.users.map((u) => [u.id, u.name]));
  const data = receipt.data;
  const open = receipt.status === "pendente" || receipt.status === "duplicado";
  const matches = matchSales(data, sales, receipt.clientId);
  const others = sales.filter((s) => s.status === "aguardando_pagamento" && !matches.some((m) => m.sale.id === s.id));
  const warnings = needsAttention(data);
  const linkedSale = receipt.saleId ? sales.find((s) => s.id === receipt.saleId) : null;
  const src = asset ? `/api/biblioteca/${asset.id}` : null;

  return (
    <>
      <PageHeader
        title="Conferência de comprovante"
        description={<>Recebido em {formatDateTime(receipt.createdAt)}{receipt.clientId && <> · {clients.get(receipt.clientId)}</>}</>}
        actions={<Link href="/financeiro" className={buttonClass("ghost", "sm")}><ArrowLeft className="size-4" /> Financeiro</Link>}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="p-4">
          {src && asset?.type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="Comprovante enviado" className="max-h-[75vh] w-full rounded-xl bg-slate-50 object-contain" />
          ) : src ? (
            <a href={src} target="_blank" rel="noopener" className={buttonClass("secondary")}>Abrir o PDF do comprovante</a>
          ) : (
            <p className="text-sm text-red-600">Arquivo não encontrado.</p>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Dados do comprovante"
              description={receipt.analyzer === "ia" ? `Lido pela IA (confiança ${Math.round((data?.confianca ?? 0) * 100)}%). Confira antes de confirmar.` : "Preencha conferindo a imagem."}
              action={<Badge tone={RECEIPT_STATUS[receipt.status].tone}>{RECEIPT_STATUS[receipt.status].label}</Badge>}
            />
            <div className="space-y-4 p-5">
              {receipt.analysisError && <Notice tone="amber">{receipt.analysisError}</Notice>}
              {receipt.status === "duplicado" && (
                <Notice tone="red" title="Possível comprovante repetido">
                  Já existe outro comprovante com os mesmos dados{receipt.duplicateOf && <> (<Link className="underline" href={`/financeiro/comprovantes/${receipt.duplicateOf}`}>ver</Link>)</>}. Corrija os dados se for outro pagamento, ou rejeite.
                </Notice>
              )}
              {open && warnings.length > 0 && (
                <ul className="space-y-1 text-sm text-amber-700">{warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</li>)}</ul>
              )}
              {data?.observacao && <p className="text-sm text-slate-600">Observação: {data.observacao}</p>}
              {open ? (
                <ActionForm action={saveReceiptAction} submitLabel="Salvar dados" success="Dados salvos.">
                  <input type="hidden" name="id" value={receipt.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Valor (R$)" htmlFor="valor"><Input id="valor" name="valor" inputMode="decimal" defaultValue={cents(data?.valorCentavos)} /></Field>
                    <Field label="Data do pagamento" htmlFor="dataPagamento"><Input id="dataPagamento" name="dataPagamento" type="date" defaultValue={data?.dataPagamento ?? ""} /></Field>
                  </div>
                  <Field label="Pagador" htmlFor="pagador"><Input id="pagador" name="pagador" maxLength={160} defaultValue={data?.pagador ?? ""} /></Field>
                  <Field label="Recebedor" htmlFor="recebedor"><Input id="recebedor" name="recebedor" maxLength={160} defaultValue={data?.recebedor ?? ""} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Banco" htmlFor="banco"><Input id="banco" name="banco" maxLength={80} defaultValue={data?.banco ?? ""} /></Field>
                    <Field label="Forma" htmlFor="metodo">
                      <Select id="metodo" name="metodo" defaultValue={data?.metodo ?? ""}>
                        <option value="">—</option>
                        {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <Field label="ID da transação" htmlFor="idTransacao"><Input id="idTransacao" name="idTransacao" maxLength={120} defaultValue={data?.idTransacao ?? ""} /></Field>
                  <input type="hidden" name="observacao" value={data?.observacao ?? ""} />
                </ActionForm>
              ) : (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <dt className="text-slate-500">Valor</dt><dd className="font-semibold">{data?.valorCentavos ? money(data.valorCentavos) : "—"}</dd>
                  <dt className="text-slate-500">Data</dt><dd>{data?.dataPagamento ? formatDate(`${data.dataPagamento}T12:00:00Z`) : "—"}</dd>
                  <dt className="text-slate-500">Pagador</dt><dd>{data?.pagador ?? "—"}</dd>
                  <dt className="text-slate-500">ID</dt><dd className="break-all">{data?.idTransacao ?? "—"}</dd>
                  <dt className="text-slate-500">Revisado por</dt><dd>{receipt.reviewedBy ? users.get(receipt.reviewedBy) ?? "—" : "—"}{receipt.reviewedAt && ` · ${formatDateTime(receipt.reviewedAt)}`}</dd>
                </dl>
              )}
            </div>
          </Card>

          {linkedSale && (
            <Notice tone="green" title="Pagamento confirmado">
              <CheckCircle2 className="mr-1 inline size-4" /> Venda <Link className="underline" href="/vendas">nº {linkedSale.number}</Link> — {clients.get(linkedSale.clientId)} — {money(linkedSale.totalCents)}
            </Notice>
          )}

          {receipt.status === "pendente" && (
            <Card>
              <CardHeader title="Confirmar pagamento" description="Vincule à venda paga. A venda é baixada, entra no financeiro e a produção é liberada." />
              <div className="p-5">
                {matches.length + others.length === 0 ? (
                  <p className="text-sm text-slate-500">Nenhuma venda aguardando pagamento. <Link className="text-brand-700 underline" href="/vendas">Registre a venda</Link> primeiro.</p>
                ) : (
                  <ActionForm action={confirmReceiptAction} submitLabel="Confirmar pagamento" success="Pagamento confirmado.">
                    <input type="hidden" name="id" value={receipt.id} />
                    <Field label="Venda" htmlFor="saleId">
                      <Select id="saleId" name="saleId" required defaultValue={matches[0]?.sale.id ?? ""}>
                        <option value="">— Escolha —</option>
                        {matches.map((m) => (
                          <option key={m.sale.id} value={m.sale.id}>nº {m.sale.number} · {clients.get(m.sale.clientId)} · {money(m.sale.totalCents)} ({m.reasons.join(", ") || "em aberto"})</option>
                        ))}
                        {others.map((s) => <option key={s.id} value={s.id}>nº {s.number} · {clients.get(s.clientId)} · {money(s.totalCents)} (valor diferente)</option>)}
                      </Select>
                    </Field>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="acceptDifference" /> Aceitar diferença de valor (pagamento parcial ou com desconto)</label>
                  </ActionForm>
                )}
              </div>
            </Card>
          )}

          {open && (
            <Card>
              <CardHeader title="Outras ações" />
              <div className="space-y-4 p-5">
                <ActionForm action={reanalyzeReceiptAction} submitLabel="Ler novamente com a IA">
                  <input type="hidden" name="id" value={receipt.id} />
                </ActionForm>
                <ActionForm action={rejectReceiptAction} submitLabel="Rejeitar comprovante" success="Comprovante rejeitado.">
                  <input type="hidden" name="id" value={receipt.id} />
                  <Field label="Motivo da rejeição" htmlFor="reason"><Input id="reason" name="reason" required minLength={3} maxLength={300} /></Field>
                </ActionForm>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
