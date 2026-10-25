"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Paperclip, Send, Sparkles, UserRound, X, Zap } from "lucide-react";
import { Button, Input, Notice, Select, cn } from "@/components/ui";
import { STAGES } from "@/lib/data/types";
import { renderTemplate, templateVariableCount } from "@/lib/segmentation";
import { markReadAction, sendMessageAction, sendTemplateAction, simulateInboundAction } from "../actions";
import { discardSuggestionAction, suggestReplyAction, type AiSuggestion } from "../ai-actions";

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
  aiEnabled: boolean;
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

const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<string, string>;

function TextComposer({ conversationId, quickReplies, aiEnabled }: { conversationId: string; quickReplies: QR[]; aiEnabled: boolean }) {
  const [state, action, pending] = useActionState(sendMessageAction, undefined);
  const [text, setText] = useState("");
  const [showQR, setShowQR] = useState(false);
  const [ai, setAi] = useState<Extract<AiSuggestion, { ok: true }> | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [thinking, startThinking] = useTransition();
  const [attach, setAttach] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const lastOk = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state?.ok && state.ok !== lastOk.current) {
      lastOk.current = state.ok;
      setText("");
      setAi(null);
    }
  }, [state]);

  const askAi = () =>
    startThinking(async () => {
      setAiError(null);
      const r = await suggestReplyAction(conversationId);
      if (!r.ok) return setAiError(r.error);
      setAi(r);
      setText(r.text);
    });
  const discardAi = () => {
    if (ai) void discardSuggestionAction(ai.id);
    setAi(null);
    setText("");
  };

  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const matches = useMemo(
    () => (slash !== null ? quickReplies.filter((q) => q.shortcut.includes(slash) || q.title.toLowerCase().includes(slash)) : quickReplies),
    [slash, quickReplies],
  );
  const open = showQR || (slash !== null && matches.length > 0);

  return (
    <form ref={formRef} action={action} className="relative p-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      {ai && <input type="hidden" name="aiSuggestionId" value={ai.id} />}
      {state?.error && <div className="mb-2"><Notice tone="red">{state.error}</Notice></div>}
      {aiError && <div className="mb-2"><Notice tone="amber">{aiError}</Notice></div>}
      {ai && (
        <div className={cn("mb-2 flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] ring-1", ai.needsHuman ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-violet-50 text-violet-900 ring-violet-200")}>
          {ai.needsHuman ? <UserRound className="mt-0.5 size-4 shrink-0" /> : <Sparkles className="mt-0.5 size-4 shrink-0" />}
          <p className="flex-1">
            <strong>{ai.needsHuman ? "Atenção: decisão humana necessária. " : "Sugestão da IA — revise antes de enviar. "}</strong>
            {ai.reason}
            {ai.stage !== "manter" && STAGE_LABEL[ai.stage] && <span className="block text-[11.5px] opacity-80">Etapa sugerida no funil: {STAGE_LABEL[ai.stage]}</span>}
          </p>
          <button type="button" onClick={discardAi} className="rounded p-0.5 hover:bg-black/5" aria-label="Descartar sugestão" title="Descartar sugestão">
            <X className="size-4" />
          </button>
        </div>
      )}
      {attach && <AttachForm conversationId={conversationId} caption={text} onDone={() => { setAttach(false); setText(""); }} onCancel={() => setAttach(false)} />}
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
        <button
          type="button"
          onClick={() => setAttach((v) => !v)}
          className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-100 hover:text-brand-600"
          title="Enviar imagem, áudio, vídeo ou documento"
          aria-label="Anexar arquivo"
        >
          <Paperclip className="size-5" />
        </button>
        {aiEnabled && (
          <button
            type="button"
            onClick={askAi}
            disabled={thinking}
            className="rounded-xl p-2.5 text-violet-600 hover:bg-violet-50 disabled:animate-pulse"
            title="Sugerir resposta com IA (você revisa antes de enviar)"
            aria-label="Sugerir resposta com IA"
          >
            <Sparkles className="size-5" />
          </button>
        )}
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

function AttachForm({ conversationId, caption, onDone, onCancel }: { conversationId: string; caption: string; onDone: () => void; onCancel: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const submit = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Selecione um arquivo.");
    setSending(true);
    setError(null);
    const form = new FormData();
    form.set("conversationId", conversationId);
    form.set("caption", caption);
    form.set("file", file);
    const res = await fetch("/api/whatsapp/enviar-midia", { method: "POST", body: form }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setSending(false);
    if (!res?.ok) return setError(json?.error ?? "Falha no envio.");
    onDone();
    router.refresh();
  };
  return (
    <div className="mb-2 rounded-xl border border-line bg-slate-50 p-2.5 text-[13px]">
      {error && <div className="mb-2"><Notice tone="red">{error}</Notice></div>}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" name="file" aria-label="Arquivo" accept="image/jpeg,image/png,audio/*,video/mp4,video/3gpp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" className="min-w-0 flex-1 text-[13px]" />
        <Button type="button" size="sm" onClick={submit} disabled={sending}>{sending ? "Enviando…" : "Enviar arquivo"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
      <p className="mt-1 text-[11.5px] text-slate-500">O texto digitado vira a legenda. Imagens até 5 MB; demais arquivos até 16 MB.</p>
    </div>
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
