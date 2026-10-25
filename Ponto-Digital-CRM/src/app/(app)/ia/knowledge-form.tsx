"use client";

import { useActionState, useState } from "react";
import { FlaskConical, UserRound } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, Notice, Textarea } from "@/components/ui";
import type { Knowledge } from "@/lib/ai/prompt";
import { saveKnowledgeAction, testKnowledgeAction } from "./actions";

type FieldDef = { key: keyof Knowledge; label: string; hint: string; max: number };

export function KnowledgeForm({ initial, fields, canTest }: { initial: (Knowledge & { enabled: boolean }) | null; fields: FieldDef[]; canTest: boolean }) {
  const [state, save, saving] = useActionState(saveKnowledgeAction, undefined);
  const [test, runTest, testing] = useActionState(testKnowledgeAction, undefined);
  // Campos controlados: o React limpa formulários após cada ação, e o texto da base não pode se perder.
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, initial?.[f.key] ?? ""])));
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [question, setQuestion] = useState("");

  return (
    <form action={save} className="space-y-6">
      <Card>
        <CardHeader title="Base de conhecimento" description="Quanto mais completa e clara, melhores as sugestões. Não coloque senhas nem dados de clientes aqui." />
        <div className="space-y-4 p-5">
          {state?.error && <Notice tone="red">{state.error}</Notice>}
          {state?.ok && <Notice tone="green">Base de conhecimento salva.</Notice>}
          {fields.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`kb-${f.key}`} hint={f.hint}>
              <Textarea
                id={`kb-${f.key}`}
                name={f.key}
                rows={f.key === "faq" || f.key === "services" || f.key === "prices" ? 6 : 3}
                maxLength={f.max}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </Field>
          ))}
          <label className="flex items-start gap-2 rounded-xl bg-violet-50 px-3 py-2.5 text-sm text-violet-900">
            <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5 accent-violet-600" />
            <span><b>Ativar sugestões de resposta no Atendimento.</b> A equipe verá o botão de IA nas conversas; nada é enviado sem revisão humana.</span>
          </label>
          <div className="flex justify-end">
            <Button disabled={saving}>{saving ? "Salvando…" : "Salvar base de conhecimento"}</Button>
          </div>
        </div>
      </Card>

      {canTest && (
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><FlaskConical className="size-4 text-violet-600" /> Testar antes de ativar</span>} description="Usa o texto acima (mesmo sem salvar). Nada é enviado a clientes; o teste consome um pouco da cota da IA." />
          <div className="space-y-3 p-5">
            <Field label="Pergunta de um cliente" htmlFor="question">
              <Input id="question" name="question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex.: Quanto custa um site para minha loja?" />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="outline" formAction={runTest} disabled={testing}>{testing ? "Pensando…" : "Ver sugestão da IA"}</Button>
            </div>
            {test?.error && <Notice tone="red">{test.error}</Notice>}
            {test?.reply && (
              <div className="space-y-2">
                <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3.5 py-2.5 text-[14px] text-slate-800">{test.reply}</p>
                <p className="flex items-start gap-1.5 text-[12.5px] text-slate-500">
                  {test.needsHuman && <UserRound className="mt-0.5 size-3.5 shrink-0 text-amber-600" />}
                  {test.needsHuman ? "Pediria um humano: " : ""}{test.reason}
                </p>
              </div>
            )}
          </div>
        </Card>
      )}
    </form>
  );
}
