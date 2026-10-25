import Link from "next/link";
import { Card, CardHeader, cn, Input, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Auditoria" };
export const instant = false;

const GROUPS = [
  { id: "", label: "Tudo" },
  { id: "auth.", label: "Acessos" },
  { id: "cliente.", label: "Clientes" },
  { id: "lgpd.", label: "LGPD" },
  { id: "consentimento.", label: "Consentimento" },
  { id: "campanha.", label: "Campanhas" },
  { id: "usuario.", label: "Usuários" },
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ g?: string; q?: string }> }) {
  const user = await requireUser("audit:read");
  const { g = "", q = "" } = await searchParams;
  const d = await scoped(user.orgId);
  const users = new Map(d.users.map((u) => [u.id, u.name]));
  const term = q.toLowerCase();
  const logs = d.auditLogs
    .filter((l) => !g || l.action.startsWith(g))
    .filter((l) => !term || `${l.action} ${l.details} ${users.get(l.userId ?? "") ?? ""}`.toLowerCase().includes(term))
    .slice(0, 300);

  return (
    <>
      <PageHeader title="Registros de auditoria" description="Quem fez o quê e quando. Os registros não podem ser editados pela interface." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <nav className="flex flex-wrap gap-1 text-[13px]">
            {GROUPS.map((x) => (
              <Link key={x.id} href={`/auditoria?g=${x.id}`} className={cn("rounded-lg px-2.5 py-1 font-medium", g === x.id ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100")}>
                {x.label}
              </Link>
            ))}
          </nav>
          <form className="sm:ml-auto sm:w-64">
            <input type="hidden" name="g" value={g} />
            <Input name="q" defaultValue={q} placeholder="Buscar…" aria-label="Buscar nos registros" className="h-9" />
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Quando</th>
                <th className="px-3 py-3 font-medium">Usuário</th>
                <th className="px-3 py-3 font-medium">Ação</th>
                <th className="px-3 py-3 font-medium">Detalhes</th>
                <th className="px-5 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap px-5 py-2.5 text-slate-500 tabular-nums">{formatDateTime(l.at)}</td>
                  <td className="px-3 py-2.5">{l.userId ? users.get(l.userId) ?? "—" : "Sistema"}</td>
                  <td className="px-3 py-2.5"><code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">{l.action}</code></td>
                  <td className="max-w-md truncate px-3 py-2.5 text-slate-600" title={l.details}>{l.details || "—"}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{l.ip ?? "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">Nenhum registro.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Webhooks recebidos do WhatsApp" description="Últimos eventos processados (apenas resumo — o conteúdo fica nas conversas)." />
        <ul className="divide-y divide-line text-sm">
          {d.webhookEvents.slice(0, 20).map((w) => (
            <li key={w.id} className="flex justify-between px-5 py-2.5">
              <span><code className="text-[12px]">{w.field}</code> · {w.summary}</span>
              <span className="text-slate-500">{formatDateTime(w.receivedAt)}</span>
            </li>
          ))}
          {d.webhookEvents.length === 0 && <li className="px-5 py-6 text-center text-slate-500">Nenhum webhook recebido ainda.</li>}
        </ul>
      </Card>
    </>
  );
}
