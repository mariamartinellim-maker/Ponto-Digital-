"use client";

import Link from "next/link";
import { useActionState, useOptimistic, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Avatar, Button, Field, Input, Notice, Select, cn } from "@/components/ui";
import { STAGES, type Stage } from "@/lib/data/types";
import { money, moneyCompact } from "@/lib/format";
import { moveDealAction, saveDealAction } from "./actions";

export interface BoardDeal {
  id: string;
  title: string;
  valueCents: number;
  stage: Stage;
  clientId: string;
  clientName: string;
  ownerName: string | null;
  updatedAt: string;
}

const ACCENT: Record<Stage, string> = {
  novo_lead: "bg-slate-400",
  em_atendimento: "bg-sky-500",
  proposta_enviada: "bg-brand-500",
  fechado: "bg-emerald-500",
  perdido: "bg-red-400",
};

export function Board({ deals, clients, canEdit }: { deals: BoardDeal[]; clients: { id: string; name: string }[]; canEdit: boolean }) {
  const [optimistic, applyMove] = useOptimistic(deals, (state, m: { id: string; stage: Stage }) =>
    state.map((d) => (d.id === m.id ? { ...d, stage: m.stage } : d)),
  );
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const move = (id: string, stage: Stage) => {
    const deal = optimistic.find((d) => d.id === id);
    if (!deal || deal.stage === stage) return;
    startTransition(async () => {
      applyMove({ id, stage });
      try {
        setError(null);
        await moveDealAction(id, stage);
      } catch {
        setError("Não foi possível mover a oportunidade. Tente novamente.");
      }
    });
  };

  return (
    <>
      {error && <div className="mb-4"><Notice tone="red">{error}</Notice></div>}
      {canEdit && (
        <div className="mb-4">
          {showNew ? <NewDeal clients={clients} onDone={() => setShowNew(false)} /> : (
            <Button variant="outline" onClick={() => setShowNew(true)}><Plus className="size-4" /> Nova oportunidade</Button>
          )}
        </div>
      )}
      <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 scroll-thin sm:mx-0 sm:px-0">
        {STAGES.map((s) => {
          const items = optimistic.filter((d) => d.stage === s.id);
          const total = items.reduce((a, d) => a + d.valueCents, 0);
          return (
            <section
              key={s.id}
              aria-label={s.label}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setDragOver(s.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                move(e.dataTransfer.getData("text/plain"), s.id);
              }}
              className={cn(
                "flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col rounded-2xl border bg-slate-100/70 transition-colors sm:w-[270px] 2xl:w-auto 2xl:min-w-0 2xl:max-w-none 2xl:flex-1 2xl:basis-0",
                dragOver === s.id ? "border-brand-300 bg-brand-50" : "border-transparent",
              )}
            >
              <header className="flex items-center justify-between px-3.5 pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", ACCENT[s.id])} />
                  <h2 className="text-[13px] font-semibold text-slate-800">{s.label}</h2>
                  <span className="rounded-full bg-white px-1.5 text-[11px] font-medium text-slate-500">{items.length}</span>
                </div>
                <span className="text-[12px] font-medium text-slate-500">{moneyCompact(total)}</span>
              </header>
              <ul className="flex min-h-24 flex-1 flex-col gap-2 p-2 pt-1">
                {items.map((d) => (
                  <li
                    key={d.id}
                    draggable={canEdit}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", d.id)}
                    className={cn("rounded-xl border border-line bg-white p-3 shadow-card", canEdit && "cursor-grab active:cursor-grabbing")}
                  >
                    <Link href={`/clientes/${d.clientId}`} className="block text-[13.5px] font-medium text-slate-900 hover:text-brand-700">
                      {d.clientName}
                    </Link>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] text-slate-500">{d.title}</p>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-slate-800 tabular-nums">{money(d.valueCents)}</span>
                      {d.ownerName && <Avatar name={d.ownerName} size="sm" />}
                    </div>
                    {canEdit && (
                      <select
                        aria-label={`Mover ${d.clientName} para outra etapa`}
                        value={d.stage}
                        onChange={(e) => move(d.id, e.target.value as Stage)}
                        className="mt-2.5 w-full rounded-lg border border-line bg-slate-50 px-2 py-1 text-[12px] text-slate-600"
                      >
                        {STAGES.map((o) => (
                          <option key={o.id} value={o.id}>{o.id === d.stage ? `Etapa: ${o.label}` : `Mover para ${o.label}`}</option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function NewDeal({ clients, onDone }: { clients: { id: string; name: string }[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof saveDealAction>>, fd: FormData) => {
    const r = await saveDealAction(prev, fd);
    if (r?.ok) onDone();
    return r;
  }, undefined);
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-3 rounded-2xl border border-line bg-white p-4 shadow-card sm:grid-cols-[1fr_1fr_160px_auto]">
      <Field label="Cliente" htmlFor="clientId">
        <Select id="clientId" name="clientId" required>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Título" htmlFor="title"><Input id="title" name="title" required placeholder="Ex.: Pacote de tráfego pago" /></Field>
      <Field label="Valor (R$)" htmlFor="value"><Input id="value" name="value" inputMode="decimal" placeholder="2.500,00" /></Field>
      <div className="flex gap-2">
        <Button disabled={pending}>Adicionar</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
      </div>
      {state?.error && <p className="text-sm text-red-600 sm:col-span-4">{state.error}</p>}
    </form>
  );
}
