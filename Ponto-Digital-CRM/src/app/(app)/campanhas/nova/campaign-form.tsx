"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Ban, ShieldCheck, Users } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, Notice, Select, cn } from "@/components/ui";
import { STAGES, type Segment, type Stage } from "@/lib/data/types";
import { renderTemplate } from "@/lib/segmentation";
import { createCampaignAction, previewAudienceAction } from "../actions";

type Preview = Awaited<ReturnType<typeof previewAudienceAction>>;

function Chips({ name, options, value, onChange }: { name: string; options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <label key={o.id} className={cn("cursor-pointer rounded-full border px-3 py-1 text-[13px] transition-colors", on ? "border-brand-300 bg-brand-50 font-medium text-brand-700" : "border-line bg-white text-slate-600 hover:bg-slate-50")}>
            <input type="checkbox" name={name} value={o.id} checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])} className="sr-only" />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

export function CampaignForm({ cities, services, tags, templates }: { cities: string[]; services: string[]; tags: string[]; templates: { id: string; name: string; body: string; category: string }[] }) {
  const [state, action, pending] = useActionState(createCampaignAction, undefined);
  const [seg, setSeg] = useState<Segment>({ cities: [], services: [], stages: [], tags: [] });
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, startPreview] = useTransition();
  const tpl = templates.find((t) => t.id === tplId);

  useEffect(() => {
    startPreview(async () => setPreview(await previewAudienceAction(seg)));
  }, [seg]);

  const opt = (xs: string[]) => xs.map((x) => ({ id: x, label: x }));
  return (
    <form action={action} className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="1. Identificação e modelo" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <Field label="Nome da campanha" htmlFor="name"><Input id="name" name="name" required placeholder="Ex.: Black Friday — Campinas" /></Field>
            <Field label="Modelo aprovado" htmlFor="templateId" hint="Somente modelos aprovados pela Meta podem ser usados.">
              <Select id="templateId" name="templateId" value={tplId} onChange={(e) => setTplId(e.target.value)} required>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            {tpl && (
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-[13px] font-medium text-slate-700">Prévia</p>
                <div className="max-w-md whitespace-pre-wrap rounded-2xl rounded-bl-md bg-[#f7f7fb] px-4 py-3 text-sm text-slate-700 ring-1 ring-line">
                  {renderTemplate(tpl.body, ["Maria", "amanhã às 15h"])}
                </div>
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="2. Segmentação" description="Sem filtros = todos os clientes. Filtros diferentes se somam (E); opções do mesmo filtro são alternativas (OU)." />
          <div className="space-y-5 p-5">
            <div><p className="mb-2 text-[13px] font-medium text-slate-700">Cidades</p><Chips name="cities" options={opt(cities)} value={seg.cities} onChange={(v) => setSeg({ ...seg, cities: v })} /></div>
            <div><p className="mb-2 text-[13px] font-medium text-slate-700">Serviços contratados</p><Chips name="services" options={opt(services)} value={seg.services} onChange={(v) => setSeg({ ...seg, services: v })} /></div>
            <div><p className="mb-2 text-[13px] font-medium text-slate-700">Etapa no funil</p><Chips name="stages" options={STAGES.map((s) => ({ id: s.id, label: s.label }))} value={seg.stages} onChange={(v) => setSeg({ ...seg, stages: v as Stage[] })} /></div>
            {tags.length > 0 && <div><p className="mb-2 text-[13px] font-medium text-slate-700">Etiquetas</p><Chips name="tags" options={opt(tags)} value={seg.tags} onChange={(v) => setSeg({ ...seg, tags: v })} /></div>}
          </div>
        </Card>
      </div>

      <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <Card className={cn("p-5 transition-opacity", loading && "opacity-60")}>
          <p className="text-[13px] font-medium text-slate-500">Público estimado</p>
          <p className="mt-1 flex items-center gap-2 text-3xl font-semibold tabular-nums"><Users className="size-6 text-brand-500" />{preview?.eligible ?? "…"}</p>
          <p className="text-xs text-slate-500">contatos com consentimento (opt-in)</p>
          <ul className="mt-4 space-y-2 border-t border-line pt-4 text-[13px]">
            <li className="flex items-center justify-between"><span className="flex items-center gap-2 text-slate-600"><ShieldCheck className="size-4 text-amber-500" />Sem consentimento (excluídos)</span><b className="tabular-nums">{preview?.noConsent ?? "…"}</b></li>
            <li className="flex items-center justify-between"><span className="flex items-center gap-2 text-slate-600"><Ban className="size-4 text-red-500" />Descadastrados (excluídos)</span><b className="tabular-nums">{preview?.optOut ?? "…"}</b></li>
          </ul>
          {preview && preview.sample.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">Ex.: {preview.sample.join(", ")}{preview.eligible > preview.sample.length ? "…" : ""}</p>
          )}
        </Card>
        {state?.error && <Notice tone="red">{state.error}</Notice>}
        <Button className="w-full" disabled={pending || !tpl}>{pending ? "Salvando…" : "Salvar como rascunho"}</Button>
        <p className="text-center text-xs text-slate-500">A execução acontece na próxima tela, com confirmação.</p>
      </div>
    </form>
  );
}
