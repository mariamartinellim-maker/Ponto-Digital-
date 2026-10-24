"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, FileSpreadsheet } from "lucide-react";
import { Badge, Button, buttonClass, Card, CardHeader, Notice } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { analyzeImportAction, confirmImportAction } from "../actions";

export function ImportFlow() {
  const [analysis, analyze, analyzing] = useActionState(analyzeImportAction, undefined);
  const [result, confirm, importing] = useActionState(confirmImportAction, undefined);
  const a = analysis?.analysis;

  if (result?.imported !== undefined) {
    return (
      <Card className="p-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
        <p className="mt-3 text-lg font-semibold">{result.imported} contato(s) importado(s)</p>
        <p className="mt-1 text-sm text-slate-500">
          Duplicidades e números inválidos foram ignorados. Cada contato novo entrou no funil como “Novo Lead”.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/clientes" className={buttonClass()}>Ver clientes</Link>
          <Button variant="outline" onClick={() => window.location.reload()}>Nova importação</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. Selecione o arquivo" description="CSV separado por vírgula ou ponto e vírgula, com cabeçalho na primeira linha." />
        <form action={analyze} className="space-y-4 p-5">
          {analysis?.error && <Notice tone="red">{analysis.error}</Notice>}
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-slate-50 px-6 py-10 text-center hover:border-brand-300 hover:bg-brand-50/40">
            <FileSpreadsheet className="size-8 text-brand-500" />
            <span className="text-sm font-medium text-slate-700">Clique para escolher o arquivo .csv</span>
            <span className="text-xs text-slate-500">Colunas aceitas: nome, telefone, email, cidade, servicos, observacoes, consentimento</span>
            <input type="file" name="file" accept=".csv,text/csv" required className="mt-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white" />
          </label>
          <div className="flex items-center justify-between gap-3">
            <a href="/modelo-importacao.csv" download className="text-sm font-medium text-brand-600 hover:text-brand-700">Baixar planilha modelo</a>
            <Button disabled={analyzing}>{analyzing ? "Analisando…" : "Analisar arquivo"}</Button>
          </div>
        </form>
      </Card>

      {a && (
        <Card>
          <CardHeader title="2. Revise antes de importar" description={`${a.totalLines} linha(s) lidas`} />
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
            <Stat label="Novos contatos" value={a.valid.length} tone="text-emerald-600" />
            <Stat label="Duplicados no arquivo" value={a.duplicatesInFile.length} tone="text-amber-600" />
            <Stat label="Já cadastrados" value={a.alreadyExists.length} tone="text-sky-600" />
            <Stat label="Inválidos" value={a.invalid.length} tone="text-red-600" />
          </div>

          {a.valid.length > 0 && (
            <div className="max-h-72 overflow-auto border-y border-line scroll-thin">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs uppercase text-slate-500">
                  <tr><th className="px-5 py-2 font-medium">Linha</th><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 font-medium">Telefone</th><th className="px-3 py-2 font-medium">Cidade</th><th className="px-3 py-2 font-medium">Consentimento</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {a.valid.slice(0, 200).map((r) => (
                    <tr key={r.line}>
                      <td className="px-5 py-2 text-slate-400">{r.line}</td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 tabular-nums">{formatPhone(r.phone)}</td>
                      <td className="px-3 py-2">{r.city || "—"}</td>
                      <td className="px-3 py-2">{r.consent ? <Badge tone="green">Sim</Badge> : <Badge>Não informado</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(a.duplicatesInFile.length > 0 || a.alreadyExists.length > 0 || a.invalid.length > 0) && (
            <details className="border-b border-line px-5 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">Ver linhas ignoradas</summary>
              <ul className="mt-2 space-y-1 text-slate-600">
                {a.duplicatesInFile.map((r) => <li key={`d${r.line}`}>Linha {r.line}: {r.name} — mesmo telefone da linha {r.firstLine}</li>)}
                {a.alreadyExists.map((r) => <li key={`e${r.line}`}>Linha {r.line}: {r.name} — já existe no CRM</li>)}
                {a.invalid.map((r) => <li key={`i${r.line}`}>Linha {r.line}: {r.reason}</li>)}
              </ul>
            </details>
          )}

          <form action={confirm} className="space-y-4 p-5">
            <input type="hidden" name="csv" value={analysis?.csv ?? ""} />
            {result?.error && <Notice tone="red">{result.error}</Notice>}
            {a.valid.some((r) => r.consent) && (
              <label className="flex items-start gap-3 rounded-xl border border-line bg-slate-50 p-3 text-sm">
                <input type="checkbox" name="consentConfirmed" className="mt-0.5 accent-brand-600" />
                <span>
                  <span className="font-medium">Confirmo que tenho comprovação do consentimento</span> dos contatos marcados como “Sim”.
                  <span className="block text-xs text-slate-500">Sem esta confirmação, todos entram como “Sem consentimento” e não recebem campanhas.</span>
                </span>
              </label>
            )}
            <div className="flex justify-end">
              <Button disabled={importing || a.valid.length === 0}>
                {importing ? "Importando…" : `Importar ${a.valid.length} contato(s)`}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
