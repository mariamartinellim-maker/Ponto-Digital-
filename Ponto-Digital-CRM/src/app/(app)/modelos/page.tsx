import { Trash2, Zap } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import type { TemplateStatus } from "@/lib/data/types";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isSupabase } from "@/lib/supabase/server";
import { deleteQuickReplyAction, saveQuickReplyAction, saveTemplateAction, simulateTemplateReviewAction, submitTemplateToMetaAction, syncTemplatesAction } from "./actions";

export const metadata = { title: "Modelos e respostas" };
export const instant = false;

const STATUS: Record<TemplateStatus, { label: string; tone: "green" | "amber" | "red" }> = {
  APPROVED: { label: "Aprovado pela Meta", tone: "green" },
  PENDING: { label: "Em análise", tone: "amber" },
  REJECTED: { label: "Rejeitado", tone: "red" },
};

export default async function TemplatesPage() {
  const user = await requireUser();
  const d = await scoped(user.orgId);
  const canQR = can(user.role, "quick_replies:manage");
  const canTpl = can(user.role, "templates:manage");
  const real = isSupabase();

  return (
    <>
      <PageHeader
        title="Modelos e respostas rápidas"
        description="Respostas rápidas agilizam o atendimento. Modelos (templates) aprovados pela Meta são obrigatórios para campanhas e para retomar conversas após 24h."
      />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Zap className="size-4 text-coral-500" /> Respostas rápidas</span>} description="Digite / na conversa para inserir." />
          <ul className="divide-y divide-line">
            {d.quickReplies.map((q) => (
              <li key={q.id} className="flex items-start gap-3 px-5 py-3">
                <code className="mt-0.5 rounded-md bg-brand-50 px-1.5 py-0.5 text-[12px] font-medium text-brand-700">/{q.shortcut}</code>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{q.title}</p>
                  <p className="text-[13px] text-slate-500">{q.body}</p>
                </div>
                {canQR && (
                  <form action={deleteQuickReplyAction}>
                    <input type="hidden" name="id" value={q.id} />
                    <button className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Excluir /${q.shortcut}`}>
                      <Trash2 className="size-4" />
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {canQR && (
            <div className="border-t border-line bg-slate-50/60 p-5">
              <p className="mb-3 text-sm font-semibold">Nova resposta rápida</p>
              <ActionForm action={saveQuickReplyAction} submitLabel="Adicionar resposta" success="Resposta adicionada.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
                  <Field label="Atalho" htmlFor="shortcut"><Input id="shortcut" name="shortcut" placeholder="ex.: preco" required /></Field>
                  <Field label="Título" htmlFor="qr-title"><Input id="qr-title" name="title" required /></Field>
                </div>
                <Field label="Texto" htmlFor="qr-body"><Textarea id="qr-body" name="body" rows={3} required /></Field>
              </ActionForm>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Modelos de mensagem (WhatsApp)"
            description="Idioma pt_BR · variáveis no formato {{1}}, {{2}}"
            action={real && canTpl ? (
              <ActionForm action={syncTemplatesAction} submitLabel="Sincronizar com a Meta" success="Status atualizados com a Meta." className="flex items-center gap-2">
                <span />
              </ActionForm>
            ) : undefined}
          />
          <ul className="divide-y divide-line">
            {d.templates.map((t) => (
              <li key={t.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-[13px] font-semibold text-slate-800">{t.name}</code>
                  <Badge tone={t.category === "MARKETING" ? "coral" : "sky"}>{t.category === "MARKETING" ? "Marketing" : "Utilidade"}</Badge>
                  <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                  <span className="ml-auto text-xs text-slate-400">{formatDate(t.createdAt)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-slate-600">{t.body}</p>
                {real && t.metaTemplateId && t.status === "PENDING" && <p className="mt-2 text-xs text-amber-700">Enviado à Meta · aguardando análise</p>}
                {real && t.status === "REJECTED" && <p className="mt-2 text-xs text-red-600">A Meta rejeitou este modelo. Ajuste o texto e crie um novo com outro nome.</p>}
                {real && canTpl && !t.metaTemplateId && (
                  <div className="mt-2">
                    <ActionForm action={submitTemplateToMetaAction} submitLabel="Enviar para análise da Meta" success="Enviado. A Meta costuma responder em minutos." className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <span className="text-xs text-slate-500">Ainda não enviado à Meta (gratuito; não envia mensagem a clientes).</span>
                    </ActionForm>
                  </div>
                )}
                {!real && canTpl && t.status === "PENDING" && (
                  <form action={simulateTemplateReviewAction} className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <span className="text-xs text-amber-700">Demonstração:</span>
                    <Button size="sm" variant="secondary" name="status" value="APPROVED">Simular aprovação</Button>
                    <Button size="sm" variant="ghost" name="status" value="REJECTED">Simular rejeição</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {canTpl && (
            <div className="border-t border-line bg-slate-50/60 p-5">
              <p className="mb-3 text-sm font-semibold">Novo modelo</p>
              <ActionForm action={saveTemplateAction} submitLabel="Salvar modelo" success="Modelo salvo. Envie-o para análise da Meta na lista acima.">
                <Notice tone="brand">
                  {real
                    ? "O modelo é salvo no CRM e depois enviado para análise da Meta pelo botão “Enviar para análise”. O status (aprovado/rejeitado) chega automaticamente."
                    : "No modo demonstração a análise da Meta é simulada."}
                </Notice>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_170px]">
                  <Field label="Nome (identificador)" htmlFor="tpl-name"><Input id="tpl-name" name="name" placeholder="ex.: promocao_natal" required /></Field>
                  <Field label="Categoria" htmlFor="category">
                    <Select id="category" name="category">
                      <option value="MARKETING">Marketing</option>
                      <option value="UTILITY">Utilidade</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Texto" htmlFor="tpl-body" hint="Marketing: inclua a opção de descadastro, ex.: “Responda SAIR para não receber mais mensagens.”">
                  <Textarea id="tpl-body" name="body" rows={4} required placeholder="Olá, {{1}}! ..." />
                </Field>
              </ActionForm>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
