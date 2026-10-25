import { isSupabase } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, CheckCheck, Clock, History, Smartphone, TriangleAlert } from "lucide-react";
import { Avatar, Badge, Button, cn, Select } from "@/components/ui";
import { ConsentBadge } from "@/components/ui/labels";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import type { Message } from "@/lib/data/types";
import { formatDate, formatTime, localDay, requestTime } from "@/lib/format";
import { canSeeConversation, windowOpen, WINDOW_MS } from "@/lib/inbox";
import { can } from "@/lib/permissions";
import { formatPhone } from "@/lib/phone";
import { updateConversationAction } from "../actions";
import { InboxShell } from "../inbox-shell";
import { Composer, MarkRead, SimulateInbound } from "./composer";

export const metadata = { title: "Conversa" };
export const instant = false;

const ORIGIN: Partial<Record<Message["origin"], { label: string; icon: typeof Smartphone }>> = {
  app_business: { label: "Enviada pelo app WhatsApp Business", icon: Smartphone },
  historico: { label: "Histórico sincronizado", icon: History },
  campanha: { label: "Campanha", icon: CheckCheck },
};

function StatusIcon({ status }: { status: Message["status"] }) {
  if (status === "lida") return <CheckCheck className="size-3.5 text-sky-300" aria-label="Lida" />;
  if (status === "entregue") return <CheckCheck className="size-3.5" aria-label="Entregue" />;
  if (status === "enviada") return <Check className="size-3.5" aria-label="Enviada" />;
  if (status === "falhou") return <TriangleAlert className="size-3.5 text-red-200" aria-label="Falhou" />;
  if (status === "simulada") return <Clock className="size-3.5" aria-label="Simulada (não enviada)" />;
  return null;
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; q?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, { f, q }] = await Promise.all([params, searchParams]);
  const d = await scoped(user.orgId);
  const conv = d.conversations.find((c) => c.id === id);
  if (!conv || !canSeeConversation(user, conv)) notFound();
  const client = d.clients.find((c) => c.id === conv.clientId)!;
  const users = new Map(d.users.map((u) => [u.id, u.name]));
  const messages = d.messages
    .filter((m) => m.conversationId === id)
    .map((m, i, all) => ({ ...m, newDay: i === 0 || localDay(m.createdAt) !== localDay(all[i - 1]!.createdAt) }));
  const open = windowOpen(conv);
  const remainingH = conv.lastInboundAt ? Math.max(0, Math.ceil((WINDOW_MS - (requestTime() - new Date(conv.lastInboundAt).getTime())) / 3600_000)) : 0;
  const canReply = can(user.role, "inbox:reply");
  const canAssign = can(user.role, "inbox:assign");

  return (
    <InboxShell user={user} activeId={id} filter={f} q={q}>
      <MarkRead conversationId={id} unread={conv.unread} />
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Link href={`/inbox${f ? `?f=${f}` : ""}`} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Voltar">
          <ArrowLeft className="size-5" />
        </Link>
        <Avatar name={client.name} />
        <div className="min-w-0 flex-1">
          <Link href={`/clientes/${client.id}`} className="block truncate font-semibold text-slate-900 hover:text-brand-700">{client.name}</Link>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="tabular-nums">{formatPhone(client.phone)}</span>
            <ConsentBadge status={client.consent.status} />
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {canAssign ? (
            <form action={updateConversationAction} className="flex items-center gap-2">
              <input type="hidden" name="conversationId" value={id} />
              <Select name="assigneeId" defaultValue={conv.assigneeId ?? ""} className="h-8 w-44 text-[13px]" aria-label="Responsável">
                <option value="">Sem responsável</option>
                {d.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
              <Button size="sm" variant="outline">Transferir</Button>
            </form>
          ) : !conv.assigneeId && canReply ? (
            <form action={updateConversationAction}>
              <input type="hidden" name="conversationId" value={id} />
              <input type="hidden" name="assigneeId" value={user.id} />
              <Button size="sm" variant="secondary">Assumir atendimento</Button>
            </form>
          ) : (
            <Badge>Responsável: {conv.assigneeId ? users.get(conv.assigneeId) : "—"}</Badge>
          )}
          {canReply && (
            <form action={updateConversationAction}>
              <input type="hidden" name="conversationId" value={id} />
              {conv.status === "resolvida" ? (
                <Button size="sm" variant="outline" name="status" value="aberta">Reabrir</Button>
              ) : (
                <Button size="sm" variant="primary" name="status" value="resolvida">Resolver</Button>
              )}
            </form>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f7fb] px-4 py-5 scroll-thin sm:px-6">
        <ol className="mx-auto flex max-w-3xl flex-col gap-2">
          {messages.map((m) => {
            const out = m.direction === "out";
            const origin = ORIGIN[m.origin];
            if (m.origin === "sistema") {
              return (
                <li key={m.id} className="my-2 self-center rounded-full bg-amber-50 px-3 py-1 text-[12px] text-amber-800 ring-1 ring-amber-200">
                  {m.body}
                </li>
              );
            }
            return (
              <li key={m.id} className="flex flex-col">
                {m.newDay && (
                  <span className="my-3 self-center rounded-full bg-white px-3 py-1 text-[11.5px] font-medium text-slate-500 shadow-card">
                    {formatDate(m.createdAt)}
                  </span>
                )}
                <div className={cn("max-w-[85%] sm:max-w-[70%]", out ? "self-end" : "self-start")}>
                  {(origin || (out && m.authorId)) && (
                    <p className={cn("mb-0.5 flex items-center gap-1 text-[11px] text-slate-400", out && "justify-end")}>
                      {origin && <origin.icon className="size-3" />}
                      {origin?.label ?? users.get(m.authorId!)}
                    </p>
                  )}
                  <div
                    className={cn(
                      "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed shadow-card",
                      out
                        ? m.origin === "app_business"
                          ? "rounded-br-md bg-emerald-600 text-white"
                          : "rounded-br-md bg-brand-600 text-white"
                        : "rounded-bl-md bg-white text-slate-800",
                      m.origin === "historico" && "opacity-80",
                    )}
                  >
                    {m.body}
                    <span className={cn("ml-2 inline-flex translate-y-0.5 items-center gap-1 text-[10.5px]", out ? "text-white/70" : "text-slate-400")}>
                      {formatTime(m.createdAt)}
                      {out && <StatusIcon status={m.status} />}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
          {messages.length === 0 && <li className="py-10 text-center text-sm text-slate-500">Nenhuma mensagem ainda.</li>}
        </ol>
      </div>

      {canReply && (
        <Composer
          key={open ? "janela-aberta" : "janela-fechada"}
          conversationId={id}
          windowOpen={open}
          remainingHours={remainingH}
          clientName={client.name}
          hasConsent={client.consent.status === "opt_in"}
          quickReplies={d.quickReplies.map((r) => ({ shortcut: r.shortcut, title: r.title, body: r.body }))}
          templates={d.templates.filter((t) => t.status === "APPROVED").map((t) => ({ id: t.id, name: t.name, body: t.body, category: t.category }))}
        />
      )}
      {!isSupabase() && <SimulateInbound conversationId={id} />}
    </InboxShell>
  );
}
