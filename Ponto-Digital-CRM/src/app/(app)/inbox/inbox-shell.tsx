import Link from "next/link";
import type { ReactNode } from "react";
import { MessagesSquare } from "lucide-react";
import { Avatar, Card, cn } from "@/components/ui";
import type { SessionUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { relativeTime, requestTime } from "@/lib/format";
import { canSeeConversation } from "@/lib/inbox";

const FILTERS = [
  { id: "todas", label: "Abertas" },
  { id: "minhas", label: "Minhas" },
  { id: "sem_responsavel", label: "Sem responsável" },
  { id: "resolvidas", label: "Resolvidas" },
] as const;

export async function InboxShell({
  user,
  activeId,
  filter = "todas",
  q = "",
  children,
}: {
  user: SessionUser;
  activeId?: string;
  filter?: string;
  q?: string;
  children: ReactNode;
}) {
  const d = await scoped(user.orgId);
  const clients = new Map(d.clients.map((c) => [c.id, c]));
  const users = new Map(d.users.map((u) => [u.id, u.name]));
  const last = new Map<string, { body: string; direction: string; origin: string }>();
  for (const m of d.messages) last.set(m.conversationId, m);
  const term = q.trim().toLowerCase();
  const nowMs = requestTime();

  const convs = d.conversations
    .filter((c) => canSeeConversation(user, c))
    .filter((c) => {
      if (filter === "resolvidas") return c.status === "resolvida";
      if (c.status === "resolvida") return false;
      if (filter === "minhas") return c.assigneeId === user.id;
      if (filter === "sem_responsavel") return !c.assigneeId;
      return true;
    })
    .filter((c) => !term || clients.get(c.clientId)?.name.toLowerCase().includes(term))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const qs = (f: string) => `?f=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="-mx-4 -my-6 grid h-[calc(100dvh-5.5rem)] grid-cols-1 overflow-hidden border-line bg-white sm:mx-0 sm:my-0 sm:rounded-2xl sm:border sm:shadow-card lg:h-[calc(100dvh-8.5rem)] lg:grid-cols-[340px_1fr]">
      <aside className={cn("flex min-h-0 flex-col border-r border-line", activeId && "hidden lg:flex")}>
        <div className="border-b border-line p-3">
          <form>
            <input type="hidden" name="f" value={filter} />
            <input
              name="q"
              defaultValue={q}
              placeholder="Buscar conversa…"
              aria-label="Buscar conversa"
              className="h-9 w-full rounded-xl border border-line bg-slate-50 px-3 text-sm focus:border-brand-300 focus:outline-none focus:ring-4 focus:ring-brand-100"
            />
          </form>
          <nav className="mt-2.5 flex gap-1 overflow-x-auto text-[12.5px] scroll-thin" aria-label="Filtros">
            {FILTERS.map((f) => (
              <Link
                key={f.id}
                href={`/inbox${qs(f.id)}`}
                className={cn(
                  "whitespace-nowrap rounded-lg px-2.5 py-1 font-medium",
                  filter === f.id ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {convs.map((c) => {
            const client = clients.get(c.clientId);
            const lm = last.get(c.id);
            return (
              <li key={c.id}>
                <Link
                  href={`/inbox/${c.id}${qs(filter)}`}
                  className={cn(
                    "flex gap-3 border-b border-line/70 px-3.5 py-3 hover:bg-slate-50",
                    activeId === c.id && "bg-brand-50/60 hover:bg-brand-50/60",
                  )}
                >
                  <Avatar name={client?.name ?? "?"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn("truncate text-sm", c.unread ? "font-semibold text-slate-900" : "font-medium text-slate-800")}>{client?.name}</p>
                      <span className="shrink-0 text-[11px] text-slate-400">{relativeTime(c.lastMessageAt, nowMs)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <p className={cn("flex-1 truncate text-[12.5px]", c.unread ? "text-slate-700" : "text-slate-500")}>
                        {lm?.direction === "out" && lm.origin !== "sistema" && "Você: "}
                        {lm?.body ?? "Sem mensagens"}
                      </p>
                      {c.unread > 0 && <span className="rounded-full bg-coral-500 px-1.5 text-[11px] font-semibold text-white">{c.unread}</span>}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {c.assigneeId ? users.get(c.assigneeId) : <span className="font-medium text-amber-600">Sem responsável</span>}
                      {c.status === "pendente" && " · Pendente"}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
          {convs.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Nenhuma conversa neste filtro.</li>}
        </ul>
      </aside>
      <section className={cn("min-h-0 flex-col", activeId ? "flex" : "hidden lg:flex")}>{children}</section>
    </div>
  );
}

export function InboxEmpty() {
  return (
    <Card className="m-auto border-0 shadow-none">
      <div className="flex flex-col items-center px-6 text-center">
        <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <MessagesSquare className="size-6" />
        </div>
        <p className="font-medium">Selecione uma conversa</p>
        <p className="mt-1 max-w-xs text-sm text-slate-500">
          Mensagens do WhatsApp chegam aqui organizadas por cliente — inclusive as enviadas pelo aplicativo WhatsApp Business.
        </p>
      </div>
    </Card>
  );
}
