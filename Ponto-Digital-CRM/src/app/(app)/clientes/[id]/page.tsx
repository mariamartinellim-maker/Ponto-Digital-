import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, MessagesSquare, ShieldCheck } from "lucide-react";
import { Badge, Button, buttonClass, Card, CardHeader, Input, PageHeader } from "@/components/ui";
import { ConsentBadge, StageBadge } from "@/components/ui/labels";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { formatDateTime, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { formatPhone } from "@/lib/phone";
import { startConversationAction } from "../../inbox/actions";
import { anonymizeClientAction, updateConsentAction } from "../actions";
import { ClientForm } from "../client-form";

export const metadata = { title: "Cliente" };
export const instant = false;

const SOURCE: Record<string, string> = {
  formulario: "Formulário",
  whatsapp: "WhatsApp",
  importacao: "Importação",
  manual: "Registro manual",
  palavra_chave: "Palavra-chave (SAIR)",
  campanha: "Campanha",
};

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("clients:read");
  const { id } = await params;
  const d = await scoped(user.orgId);
  const client = d.clients.find((c) => c.id === id);
  if (!client) notFound();

  const users = new Map(d.users.map((u) => [u.id, u.name]));
  const deals = d.deals.filter((x) => x.clientId === id);
  const tasks = d.tasks.filter((t) => t.clientId === id).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const consents = d.consentEvents.filter((e) => e.clientId === id);
  const conv = d.conversations.find((c) => c.clientId === id);
  const canWrite = can(user.role, "clients:write");

  return (
    <>
      <Link href="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Clientes
      </Link>
      <PageHeader
        title={client.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{formatPhone(client.phone)}</span>
            {client.city && <span>· {client.city}</span>}
            <ConsentBadge status={client.consent.status} />
            {client.tags.map((t) => (
              <Badge key={t} tone="brand">{t}</Badge>
            ))}
          </span>
        }
        actions={
          <>
            {can(user.role, "clients:export") && (
              <a href={`/api/clientes/${client.id}/exportar`} className={buttonClass("outline")}>
                <Download className="size-4" /> Exportar dados (LGPD)
              </a>
            )}
            {conv ? (
              <Link href={`/inbox/${conv.id}`} className={buttonClass()}>
                <MessagesSquare className="size-4" /> Abrir conversa
              </Link>
            ) : (
              can(user.role, "inbox:reply") && (
                <form action={startConversationAction}>
                  <input type="hidden" name="clientId" value={client.id} />
                  <Button><MessagesSquare className="size-4" /> Iniciar conversa</Button>
                </form>
              )
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Dados do cliente" description={`Cadastrado em ${formatDateTime(client.createdAt)}`} />
          <div className="p-5">
            {canWrite ? (
              <ClientForm client={client} users={d.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))} />
            ) : (
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">E-mail</dt><dd>{client.email || "—"}</dd></div>
                <div><dt className="text-slate-500">Responsável</dt><dd>{client.ownerId ? users.get(client.ownerId) : "—"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-slate-500">Serviços</dt><dd>{client.services.join(", ") || "—"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-slate-500">Observações</dt><dd className="whitespace-pre-wrap">{client.notes || "—"}</dd></div>
              </dl>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Oportunidades" action={<Link href="/funil" className="text-[13px] font-medium text-brand-600">Funil</Link>} />
            <ul className="divide-y divide-line">
              {deals.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{x.title}</p>
                    <p className="text-xs text-slate-500">{money(x.valueCents)}</p>
                  </div>
                  <StageBadge stage={x.stage} />
                </li>
              ))}
              {deals.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">Nenhuma oportunidade.</li>}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-brand-600" /> Consentimento (LGPD)</span>}
              description="Somente contatos com opt-in recebem campanhas."
            />
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <ConsentBadge status={client.consent.status} />
                {client.consent.at && <span className="text-xs text-slate-500">desde {formatDateTime(client.consent.at)}</span>}
              </div>
              {canWrite && (
                <form action={updateConsentAction} className="space-y-2">
                  <input type="hidden" name="id" value={client.id} />
                  <Input name="note" placeholder="Como foi obtido? Ex.: aceitou por mensagem em 10/10" maxLength={500} />
                  <div className="flex gap-2">
                    <Button name="status" value="opt_in" variant="secondary" size="sm" className="flex-1">Registrar opt-in</Button>
                    <Button name="status" value="opt_out" variant="outline" size="sm" className="flex-1">Registrar descadastro</Button>
                  </div>
                </form>
              )}
              {consents.length > 0 && (
                <ol className="space-y-2 border-t border-line pt-3 text-xs">
                  {consents.map((e) => (
                    <li key={e.id} className="flex gap-2">
                      <span className={`mt-1 size-1.5 shrink-0 rounded-full ${e.status === "opt_in" ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span>
                        <span className="font-medium text-slate-700">{e.status === "opt_in" ? "Opt-in" : "Opt-out"}</span> · {SOURCE[e.source]} · {formatDateTime(e.at)}
                        {e.byUserId && <> · por {users.get(e.byUserId)}</>}
                        {e.note && <span className="block text-slate-500">{e.note}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Tarefas" action={<Link href={`/agenda?cliente=${client.id}`} className="text-[13px] font-medium text-brand-600">Agenda</Link>} />
            <ul className="divide-y divide-line">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className={`size-2 rounded-full ${t.done ? "bg-emerald-500" : "bg-brand-400"}`} />
                  <span className={`flex-1 ${t.done ? "text-slate-400 line-through" : ""}`}>{t.title}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(t.dueAt)}</span>
                </li>
              ))}
              {tasks.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">Nenhuma tarefa.</li>}
            </ul>
          </Card>

          {can(user.role, "clients:delete") && (
            <Card className="border-red-200">
              <CardHeader title="Eliminação de dados (LGPD)" description="Anonimiza o cadastro e apaga as conversas. Não pode ser desfeito." />
              <form action={anonymizeClientAction} className="flex gap-2 p-5">
                <input type="hidden" name="id" value={client.id} />
                <Input name="confirm" placeholder="Digite ANONIMIZAR" required pattern="ANONIMIZAR" aria-label="Confirmação" />
                <Button variant="danger">Anonimizar</Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
