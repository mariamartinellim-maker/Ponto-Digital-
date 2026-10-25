import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { Badge, buttonClass, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { campaignStats } from "@/lib/campaigns";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Campanhas" };
export const instant = false;

const STATUS = {
  rascunho: { label: "Rascunho", tone: "slate" },
  concluida: { label: "Executada (simulação)", tone: "green" },
  cancelada: { label: "Cancelada", tone: "red" },
} as const;

export default async function CampaignsPage() {
  const user = await requireUser("campaigns:read");
  const d = await scoped(user.orgId);
  const templates = new Map(d.templates.map((t) => [t.id, t.name]));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <>
      <PageHeader
        title="Campanhas de WhatsApp"
        description="Envio segmentado com modelos aprovados, apenas para contatos com consentimento."
        actions={
          can(user.role, "campaigns:manage") && (
            <Link href="/campanhas/nova" className={buttonClass()}>
              <Plus className="size-4" /> Nova campanha
            </Link>
          )
        }
      />
      <div className="mb-6">
        <Notice tone="amber" title="Campanhas em modo simulação">
          Nenhuma mensagem é enviada de verdade nesta versão. O envio real só será habilitado após a integração oficial e a sua autorização expressa.
        </Notice>
      </div>
      <Card>
        {d.campaigns.length === 0 ? (
          <EmptyState icon={<Megaphone className="size-5" />} title="Nenhuma campanha ainda" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Campanha</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 text-right font-medium">Destinatários</th>
                  <th className="px-3 py-3 text-right font-medium">Entrega</th>
                  <th className="px-3 py-3 text-right font-medium">Leitura</th>
                  <th className="px-3 py-3 text-right font-medium">Respostas</th>
                  <th className="px-5 py-3 text-right font-medium">Descadastros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.campaigns.map((c) => {
                  const s = campaignStats(c);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3">
                        <Link href={`/campanhas/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">{c.name}</Link>
                        <p className="text-xs text-slate-500">
                          {templates.get(c.templateId)} · {c.executedAt ? `executada ${formatDateTime(c.executedAt)}` : `criada ${formatDateTime(c.createdAt)}`}
                        </p>
                      </td>
                      <td className="px-3 py-3"><Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge></td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.status === "concluida" ? s.n : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.status === "concluida" ? pct(s.delivered, s.n) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.status === "concluida" ? pct(s.read, s.n) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.status === "concluida" ? s.replied : "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{c.status === "concluida" ? s.optOut : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
