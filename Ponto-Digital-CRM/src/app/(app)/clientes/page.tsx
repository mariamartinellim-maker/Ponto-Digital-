import Link from "next/link";
import { MapPin, Plus, Search, Upload, Users } from "lucide-react";
import { Avatar, Badge, buttonClass, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { ConsentBadge, StageBadge } from "@/components/ui/labels";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { SERVICES, type Stage } from "@/lib/data/types";
import { relativeTime, requestTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Clientes" };
export const instant = false;

const STAGE_ORDER: Stage[] = ["fechado", "proposta_enviada", "em_atendimento", "novo_lead", "perdido"];

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("clients:read");
  const sp = await searchParams;
  const d = await scoped(user.orgId);
  const q = (sp.q ?? "").trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const city = sp.cidade ?? "";
  const service = sp.servico ?? "";
  const consent = sp.consentimento ?? "";

  const cities = [...new Set(d.clients.map((c) => c.city).filter(Boolean))].sort();
  const users = new Map(d.users.map((u) => [u.id, u.name]));
  const mainStage = new Map<string, Stage>();
  for (const deal of d.deals) {
    const cur = mainStage.get(deal.clientId);
    if (!cur || STAGE_ORDER.indexOf(deal.stage) < STAGE_ORDER.indexOf(cur)) mainStage.set(deal.clientId, deal.stage);
  }

  const rows = d.clients
    .filter((c) => {
      if (q && !(c.name.toLowerCase().includes(q) || c.email.includes(q) || (qDigits.length >= 3 && c.phone.includes(qDigits)))) return false;
      if (city && c.city !== city) return false;
      if (service && !c.services.includes(service)) return false;
      if (consent && c.consent.status !== consent) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const nowMs = requestTime();

  return (
    <>
      <PageHeader
        title="Clientes"
        description={`${d.clients.length} clientes cadastrados`}
        actions={
          <>
            {can(user.role, "clients:import") && (
              <Link href="/clientes/importar" className={buttonClass("outline")}>
                <Upload className="size-4" /> Importar CSV
              </Link>
            )}
            {can(user.role, "clients:write") && (
              <Link href="/clientes/novo" className={buttonClass()}>
                <Plus className="size-4" /> Novo cliente
              </Link>
            )}
          </>
        }
      />

      <Card>
        <form className="grid grid-cols-1 gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[1fr_180px_220px_200px_auto]" role="search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input name="q" defaultValue={sp.q} placeholder="Buscar por nome, telefone ou e-mail" className="pl-9" aria-label="Buscar" />
          </div>
          <Select name="cidade" defaultValue={city} aria-label="Cidade">
            <option value="">Todas as cidades</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select name="servico" defaultValue={service} aria-label="Serviço">
            <option value="">Todos os serviços</option>
            {SERVICES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Select name="consentimento" defaultValue={consent} aria-label="Consentimento">
            <option value="">Qualquer consentimento</option>
            <option value="opt_in">Aceita WhatsApp</option>
            <option value="desconhecido">Sem consentimento</option>
            <option value="opt_out">Descadastrado</option>
          </Select>
          <div className="flex gap-2">
            <button className={buttonClass("secondary", "md", "flex-1")}>Filtrar</button>
            {(q || city || service || consent) && (
              <Link href="/clientes" className={buttonClass("ghost")}>Limpar</Link>
            )}
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState icon={<Users className="size-5" />} title="Nenhum cliente encontrado" description="Ajuste os filtros ou cadastre um novo cliente." />
        ) : (
          <>
            {/* Tabela (desktop) */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Cliente</th>
                    <th className="px-3 py-3 font-medium">Cidade</th>
                    <th className="px-3 py-3 font-medium">Serviços</th>
                    <th className="px-3 py-3 font-medium">Etapa</th>
                    <th className="px-3 py-3 font-medium">WhatsApp</th>
                    <th className="px-3 py-3 font-medium">Responsável</th>
                    <th className="px-5 py-3 text-right font-medium">Último contato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((c) => (
                    <tr key={c.id} className="group hover:bg-slate-50/70">
                      <td className="px-5 py-3">
                        <Link href={`/clientes/${c.id}`} className="flex items-center gap-3">
                          <Avatar name={c.name} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900 group-hover:text-brand-700">{c.name}</span>
                            <span className="block text-xs text-slate-500 tabular-nums">{formatPhone(c.phone)}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{c.city || "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[260px] flex-wrap gap-1">
                          {c.services.slice(0, 2).map((s) => (
                            <Badge key={s}>{s}</Badge>
                          ))}
                          {c.services.length > 2 && <Badge>+{c.services.length - 2}</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-3">{mainStage.get(c.id) ? <StageBadge stage={mainStage.get(c.id)!} /> : "—"}</td>
                      <td className="px-3 py-3"><ConsentBadge status={c.consent.status} /></td>
                      <td className="px-3 py-3 text-slate-600">{c.ownerId ? users.get(c.ownerId) : "—"}</td>
                      <td className="px-5 py-3 text-right text-slate-500">{c.lastContactAt ? relativeTime(c.lastContactAt, nowMs) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Cartões (celular) */}
            <ul className="divide-y divide-line md:hidden">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link href={`/clientes/${c.id}`} className="flex items-start gap-3 px-4 py-3.5">
                    <Avatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{c.name}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500">
                        <MapPin className="size-3" /> {c.city || "—"} · {formatPhone(c.phone)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {mainStage.get(c.id) && <StageBadge stage={mainStage.get(c.id)!} />}
                        <ConsentBadge status={c.consent.status} />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}
