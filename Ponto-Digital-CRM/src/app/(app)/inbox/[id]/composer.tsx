"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, Send, Zap } from "lucide-react";
import { Button, Input, Notice, Select, cn } from "@/components/ui";
import { renderTemplate, templateVariableCount } from "@/lib/segmentation";
import { markReadAction, sendMessageAction, sendTemplateAction, simulateInboundAction } from "../actions";

interface QR { shortcut: string; title: string; body: string }
interface Tpl { id: string; name: string; body: string; category: string }

export function MarkRead({ conversationId, unread }: { conversationId: string; unread: number }) {
  useEffect(() => {
    if (unread > 0) void markReadAction(conversationId);
  }, [conversationId, unread]);
  return null;
}

export function Composer(props: {
  conversationId: string;
  windowOpen: boolean;
  remainingHours: number;
  clientName: string;
  hasConsent: boolean;
  quickReplies: QR[];
  templates: Tpl[];
}) {
  const [mode, setMode] = useState<"text" | "template">(props.windowOpen ? "text" : "template");
  return (
    <div className="border-t border-line bg-white">
      <div className="flex items-center justify-between gap-2 px-4 pt-2.5 text-[12px]">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMode("text")}
            disabled={!props.windowOpen}
            className={cn("rounded-lg px-2.5 py-1 font-medium disabled:opacity-40", mode === "text" ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100")}
          >
            Mensagem
          </button>
          <button
            type="button"
            onClick={() => setMode("template")}
            className={cn("rounded-lg px-2.5 py-1 font-medium", mode === "template" ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100")}
          >
            Modelo aprovado
          </button>
        </div>
        <span className={props.windowOpen ? "text-emerald-600" : "text-amber-700"}>
          {props.windowOpen ? `Janela de 24h aberta · ${props.remainingHours}h restantes` : "Janela de 24h fechada — use um modelo"}
        </span>
      </div>
      {mode === "text" ? <TextComposer {...props} /> : <TemplateComposer {...props} />}
    </div>
  );
}

function TextComposer({ conversationId, quickReplies }: { conversationId: string; quickReplies: QR[] }) {
  const [state, action, pending] = useActionState(sendMessageAction, undefined);
  const [text, setText] = useState("");
  const [showQR, setShowQR] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const lastOk = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state?.ok && state.ok !== lastOk.current) {
      lastOk.current = state.ok;
      setText("");
    }
  }, [state]);

  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const matches = useMemo(
    () => (slash !== null ? quickReplies.filter((q) => q.shortcut.includes(slash) || q.title.toLowerCase().includes(slash)) : quickReplies),
    [slash, quickReplies],
  );
  const open = showQR || (slash !== null && matches.length > 0);

  return (
    <form ref={formRef} action={action} className="relative p-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      {state?.error && <div className="mb-2"><Notice tone="red">{state.error}</Notice></div>}
      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-pop scroll-thin">
          <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Respostas rápidas</p>
          {matches.map((q) => (
            <button
              key={q.shortcut}
              type="button"
              onClick={() => {
                setText(q.body);
                setShowQR(false);
              }}
              className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-brand-50"
            >
              <span className="text-[13px] font-medium text-slate-800">/{q.shortcut}</span>
              <span className="ml-2 text-[12px] text-slate-500">{q.title}</span>
              <span className="block truncate text-[12px] text-slate-500">{q.body}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => setShowQR((v) => !v)}
          className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-100 hover:text-brand-600"
          title="Respostas rápidas (ou digite /)"
          aria-label="Respostas rápidas"
        >
          <Zap className="size-5" />
        </button>
        <textarea
          name="body"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (text.trim() && !pending) formRef.current?.requestSubmit();
            }
          }}
          rows={1}
          placeholder="Digite uma mensagem — use / para respostas rápidas"
          aria-label="Mensagem"
          className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-line bg-slate-50 px-3.5 py-2.5 text-sm focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100 field-sizing-content"
        />
        <Button disabled={pending || !text.trim()} className="h-11 w-11 !px-0" aria-label="Enviar">
          <Send className="size-4" />
        </Button>
      </div>
    </form>
  );
}

function TemplateComposer({ conversationId, templates, clientName, hasConsent }: { conversationId: string; templates: Tpl[]; clientName: string; hasConsent: boolean }) {
  const [state, action, pending] = useActionState(sendTemplateAction, undefined);
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const tpl = templates.find((t) => t.id === tplId);
  const count = tpl ? templateVariableCount(tpl.body) : 0;
  const [vars, setVars] = useState<string[]>([clientName.split(" ")[0] ?? ""]);
  const values = Array.from({ length: count }, (_, i) => vars[i] ?? "");

  if (!templates.length) return <p className="p-4 text-sm text-slate-500">Nenhum modelo aprovado. Cadastre em “Modelos e respostas”.</p>;
  return (
    <form action={action} className="space-y-2.5 p-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      {state?.error && <Notice tone="red">{state.error}</Notice>}
      {state?.ok && <Notice tone="green">Modelo registrado (envio simulado).</Notice>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select name="templateId" value={tplId} onChange={(e) => setTplId(e.target.value)} className="sm:w-64" aria-label="Modelo">
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name} · {t.category === "MARKETING" ? "Marketing" : "Utilidade"}</option>
          ))}
        </Select>
        {values.map((v, i) => (
          <Input
            key={i}
            name="var"
            value={v}
            onChange={(e) => setVars((old) => Object.assign([...old], { [i]: e.target.value }))}
            placeholder={`Variável {{${i + 1}}}`}
            aria-label={`Variável ${i + 1}`}
            required
          />
        ))}
      </div>
      {tpl && (
        <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-600">{renderTemplate(tpl.body, values)}</p>
      )}
      {tpl?.category === "MARKETING" && !hasConsent && (
        <Notice tone="amber">Este cliente não tem consentimento registrado — modelos de marketing serão bloqueados.</Notice>
      )}
      <div className="flex justify-end">
        <Button disabled={pending}><Send className="size-4" /> Enviar modelo</Button>
      </div>
    </form>
  );
}

export function SimulateInbound({ conversationId }: { conversationId: string }) {
  return (
    <details className="border-t border-dashed border-amber-200 bg-amber-50/60 px-4 py-2 text-[12.5px] text-amber-900">
      <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
        <FlaskConical className="size-3.5" /> Demonstração: simular mensagem recebida do cliente
      </summary>
      <form action={simulateInboundAction} className="mt-2 flex gap-2">
        <input type="hidden" name="conversationId" value={conversationId} />
        <Input name="text" placeholder='Ex.: "Quero saber mais" ou "SAIR" para testar o descadastro' className="h-9 bg-white" />
        <Button size="sm" variant="outline" className="h-9 shrink-0">Simular</Button>
      </form>
    </details>
  );
}
