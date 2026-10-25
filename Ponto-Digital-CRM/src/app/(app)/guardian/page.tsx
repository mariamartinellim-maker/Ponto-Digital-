import { connection } from "next/server";
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { Badge, Button, Card, CardHeader, cn, EmptyState, Field, Input, Notice, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { listBackups, overallStatus, recentEvents, runChecks, type CheckStatus } from "@/lib/guardian/guardian";
import { isSupabase } from "@/lib/supabase/server";
import { wawebConfig } from "@/lib/whatsapp-web/manager";
import { backupNowAction, checkNowAction, reconnectWaWebAction, restoreAction } from "./actions";

export const metadata = { title: "Guardian" };
export const instant = false;

const STATUS: Record<CheckStatus, { label: string; tone: "green" | "amber" | "red"; icon: typeof CheckCircle2; cls: string }> = {
  ok: { label: "Tudo certo", tone: "green", icon: CheckCircle2, cls: "text-emerald-600" },
  aviso: { label: "Atenção", tone: "amber", icon: AlertTriangle, cls: "text-amber-600" },
  erro: { label: "Problema", tone: "red", icon: XCircle, cls: "text-red-600" },
};
const LEVEL = { info: "slate", aviso: "amber", erro: "red" } as const;

export default async function GuardianPage() {
  const user = await requireUser("guardian:manage");
  await connection();
  const [checks, events, backups] = await Promise.all([runChecks(), recentEvents(user.orgId, 60), isSupabase() ? Promise.resolve([]) : listBackups()]);
  const overall = overallStatus(checks);
  const O = STATUS[overall];
  const waweb = wawebConfig();

  return (
    <>
      <PageHeader
        title="Guardian"
        description="Monitoramento contínuo, registro de falhas e recuperação segura. Nunca apaga dados nem envia mensagens."
        actions={<form action={checkNowAction}><Button variant="secondary" size="sm">Verificar agora</Button></form>}
      />
      <Card className="mb-6 flex items-center gap-4 p-5" data-guardian-status={overall}>
        <O.icon className={cn("size-8", O.cls)} />
        <div>
          <p className="text-lg font-semibold">{O.label}</p>
          <p className="text-sm text-slate-500">{checks.filter((c) => c.status === "ok").length} de {checks.length} verificações em ordem · monitor automático a cada minuto</p>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Verificações" />
            <ul className="divide-y divide-line">
              {checks.map((c) => {
                const S = STATUS[c.status];
                return (
                  <li key={c.id} className="flex items-start gap-3 px-5 py-3" data-check={c.id} data-status={c.status}>
                    <S.icon className={cn("mt-0.5 size-4 shrink-0", S.cls)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="text-xs text-slate-500">{c.detail}</p>
                    </div>
                    <Badge tone={S.tone}>{S.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Eventos recentes" description="Mudanças de estado, reconexões e backups." />
            {events.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="size-5" />} title="Nenhum evento" description="Os eventos aparecem aqui quando algo muda." />
            ) : (
              <ul className="divide-y divide-line">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                    <Badge tone={LEVEL[e.level]}>{e.level}</Badge>
                    <span className="flex-1">{e.message}</span>
                    <span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(e.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader title="Backups" description={isSupabase() ? "No Supabase, os backups são feitos pelo próprio Supabase." : "Automático a cada 6 h (guarda os 20 mais recentes)."} />
            <div className="space-y-4 p-5">
              {isSupabase() ? (
                <Notice>Restaurações no modo Supabase são feitas pelo painel do Supabase (Database → Backups).</Notice>
              ) : (
                <>
                  <ActionForm action={backupNowAction} submitLabel="Fazer backup agora" success="Backup criado."><span /></ActionForm>
                  {backups.length > 0 && (
                    <ActionForm action={restoreAction} submitLabel="Restaurar" success="Restaurado.">
                      <Field label="Backup" htmlFor="name">
                        <select id="name" name="name" className="h-10 w-full rounded-xl border border-line bg-white px-3 text-sm">
                          {backups.map((b) => <option key={b.name} value={b.name}>{formatDateTime(b.at)} · {b.name.replace(/^demo-db-\d{8}T\d{6}Z-?/, "").replace(".json", "") || "manual"} · {Math.round(b.size / 1024)} KB</option>)}
                        </select>
                      </Field>
                      <Field label="Digite RESTAURAR para confirmar" htmlFor="confirm" hint="O estado atual é guardado antes."><Input id="confirm" name="confirm" autoComplete="off" /></Field>
                    </ActionForm>
                  )}
                </>
              )}
            </div>
          </Card>
          {waweb.enabled && (
            <Card>
              <CardHeader title="WhatsApp Web (experimental)" description="Reconecta com a sessão salva, sem novo QR Code." />
              <div className="p-5">
                <ActionForm action={reconnectWaWebAction} submitLabel="Reconectar agora"><span /></ActionForm>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
