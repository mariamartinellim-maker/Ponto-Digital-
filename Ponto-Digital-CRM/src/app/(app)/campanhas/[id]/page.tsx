import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FlaskConical, Play } from "lucide-react";
import { Badge, Button, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { campaignStats } from "@/lib/campaigns";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { STAGES, type RecipientStatus } from "@/lib/data/types";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { resolveAudience } from "@/lib/segmentation";
import { cancelCampaignAction, runCampaignAction, simulateStatusesAction } from "../actions";

export const metadata = { title: "Campanha" };
export const instant = false;

const R_STATUS: Record<RecipientStatus, { label: string; tone: "slate" | "sky" | "green" | "brand" | "red" | "amber" }> = {
  simulada: { label: "Simulada", tone: "slate" },
  enviada: { label: "Enviada", tone: "sky" },
  entregue: { label: "Entregue", tone: "sky" },
  lida: { label: "Lida", tone: "green" },
  respondeu: { label: "Respondeu", tone: "brand" },
  falhou: { label: "Falhou", tone: "red" },
  descadastrou: { label: "Descadastrou", tone: "amber" },
};

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("campaigns:read");
  const { id } = await params;
  const d = await scoped(user.orgId);
  const camp = d.campaigns.find((c) => c.id === id);
  if (!camp) notFound();
  const tpl = d.templates.find((t) => t.id === camp.templateId);
  const clients = new Map(d.clients.map((c) => [c.id, c.name]));
  const manage = can(user.role, "campaigns:manage");
  const s = campaignStats(camp);
  const audience = camp.status === "rascunho" ? resolveAudience(camp.segment, d.clients, d.deals) : null;
  const seg = camp.segment;
  const stageLabel = (x: string) => STAGES.find((st) => st.id === x)?.label ?? x;
  const filters = [
    seg.cities.length && `Cidades: ${seg.cities.join(", ")}`,
    seg.services.length && `Serviços: ${seg.services.join(", ")}`,
    seg.stages.length && `Etapas: ${seg.stages.map(stageLabel).join(", ")}`,
    seg.tags.length && `Etiquetas: ${seg.tags.join(", ")}`,
  ].filter(Boolean) as string[];
  const pct = (a: number) => (s.n ? Math.round((a / s.n) * 100) : 0);
  const funnel = [
    { label: "Destinatários", value: s.n, pct: 100 },
    { label: "Entregues", value: s.delivered, pct: pct(s.delivered) },
    { label: "Lidas", value: s.read, pct: pct(s.read) },
    { label: "Respostas", value: s.replied, pct: pct(s.replied) },
  ];

  return (
    <>
      <Link href="/campanhas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Campanhas
      </Link>
      <PageHeader
        title={camp.name}
        description={`Modelo ${tpl?.name ?? "—"} · criada em ${formatDateTime(camp.createdAt)}${camp.executedAt ? ` · executada em ${formatDateTime(camp.executedAt)}` : ""}`}
        actions={<Badge tone={camp.status === "concluida" ? "green" : camp.status === "cancelada" ? "red" : "slate"}>{camp.status === "concluida" ? "Executada (simulação)" : camp.status === "cancelada" ? "Cancelada" : "Rascunho"}</Badge>}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {camp.status === "concluida" && (
            <Card>
              <CardHeader title="Resultados" description="Status atualizados pelos webhooks da Meta (simulados nesta versão)." />
              <div className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-4">
                {funnel.map((f) => (
                  <div key={f.label}>
                    <p className="text-[13px] text-slate-500">{f.label}</p>
                    <p className="text-2xl font-semibold tabular-nums">{f.value}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full brand-gradient" style={{ width: `${f.pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{f.pct}%</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-4 border-t border-line px-5 py-3 text-[13px] text-slate-600">
                <span>Falhas: <b>{s.failed}</b></span>
                <span>Descadastros: <b>{s.optOut}</b></span>
                <span>Excluídos sem consentimento: <b>{camp.excludedNoConsent}</b></span>
                <span>Excluídos descadastrados: <b>{camp.excludedOptOut}</b></span>
              </div>
              {manage && s.pending > 0 && (
                <form action={simulateStatusesAction} className="flex flex-wrap items-center gap-3 border-t border-dashed border-amber-200 bg-amber-50/60 px-5 py-3 text-[13px] text-amber-900">
                  <input type="hidden" name="id" value={camp.id} />
                  <FlaskConical className="size-4" />
                  <span className="flex-1">Demonstração: simular os retornos de status (entregue/lida/falha) que a Meta enviaria por webhook.</span>
                  <Button size="sm" variant="outline">Simular retornos</Button>
                </form>
              )}
            </Card>
          )}

          {camp.status === "concluida" && (
            <Card>
              <CardHeader title="Destinatários" />
              <ul className="max-h-[480px] divide-y divide-line overflow-y-auto scroll-thin">
                {camp.recipients.map((r) => (
                  <li key={r.clientId} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <Link href={`/clientes/${r.clientId}`} className="hover:text-brand-700">{clients.get(r.clientId) ?? "Cliente removido"}</Link>
                    <Badge tone={R_STATUS[r.status].tone}>{R_STATUS[r.status].label}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {audience && (
            <Card>
              <CardHeader title="Público atual" description="Recalculado no momento da execução." />
              <div className="grid grid-cols-3 gap-4 p-5 text-center">
                <div><p className="text-3xl font-semibold text-emerald-600 tabular-nums">{audience.eligible.length}</p><p className="text-xs text-slate-500">receberão</p></div>
                <div><p className="text-3xl font-semibold text-amber-600 tabular-nums">{audience.excludedNoConsent.length}</p><p className="text-xs text-slate-500">sem consentimento</p></div>
                <div><p className="text-3xl font-semibold text-red-600 tabular-nums">{audience.excludedOptOut.length}</p><p className="text-xs text-slate-500">descadastrados</p></div>
              </div>
              <p className="border-t border-line px-5 py-3 text-[13px] text-slate-600">
                {audience.eligible.slice(0, 12).map((c) => c.name).join(", ")}
                {audience.eligible.length > 12 && ` e mais ${audience.eligible.length - 12}`}
              </p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Configuração" />
            <div className="space-y-3 p-5 text-sm">
              <div>
                <p className="text-[13px] text-slate-500">Segmentação</p>
                {filters.length ? <ul className="mt-1 list-inside list-disc text-slate-700">{filters.map((f) => <li key={f}>{f}</li>)}</ul> : <p>Todos os clientes</p>}
              </div>
              {tpl && (
                <div>
                  <p className="text-[13px] text-slate-500">Mensagem</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[13px]">{tpl.body}</p>
                </div>
              )}
            </div>
          </Card>

          {camp.status === "rascunho" && manage && (
            <Card className="p-5">
              <form action={runCampaignAction} className="space-y-4">
                <input type="hidden" name="id" value={camp.id} />
                <Notice tone="amber" title="Execução em modo simulação">
                  Nenhuma mensagem será enviada ao WhatsApp. O sistema registra os envios e permite acompanhar o fluxo de resultados.
                </Notice>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="confirm" required className="mt-0.5 accent-brand-600" />
                  Confirmo a execução para {audience?.eligible.length ?? 0} contato(s) com consentimento.
                </label>
                <Button className="w-full" disabled={!audience?.eligible.length}><Play className="size-4" /> Executar simulação</Button>
              </form>
              <form action={cancelCampaignAction} className="mt-2">
                <input type="hidden" name="id" value={camp.id} />
                <Button variant="ghost" className="w-full">Cancelar campanha</Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
