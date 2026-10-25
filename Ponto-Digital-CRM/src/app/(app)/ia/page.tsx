import { ShieldCheck, Sparkles } from "lucide-react";
import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { KNOWLEDGE_FIELDS, type Knowledge } from "@/lib/ai/prompt";
import { env } from "@/lib/env";
import { isSupabase, supabaseServer } from "@/lib/supabase/server";
import { KnowledgeForm } from "./knowledge-form";

export const metadata = { title: "Assistente de IA" };
export const instant = false;

const LEVELS = [
  { n: 1, title: "Sugestão de respostas", body: "A IA escreve; o atendente revisa, edita e envia. Nada sai sem clique humano.", on: true },
  { n: 2, title: "Respostas simples automáticas", body: "Dúvidas frequentes respondidas sozinhas, dentro da janela de 24h, com textos aprovados por você.", on: false },
  { n: 3, title: "Qualificação e apresentação", body: "Explica serviços, faz perguntas de qualificação e move o lead no funil; passa para humano quando necessário.", on: false },
  { n: 4, title: "Link de pagamento", body: "Prepara o link (sempre com aprovação de um gestor antes do envio).", on: false },
];

export default async function AiPage() {
  const user = await requireUser("ai:manage");
  const e = env();
  let kb: (Knowledge & { enabled: boolean }) | null = null;
  const usage = { count: 0, used: 0, input: 0, output: 0, cached: 0 };
  if (isSupabase()) {
    const sb = await supabaseServer();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(3, 0, 0, 0); // meia-noite em Brasília
    const [{ data: k }, { data: rows }] = await Promise.all([
      sb.from("ai_knowledge").select("*").maybeSingle(),
      sb.from("ai_suggestions").select("status,input_tokens,output_tokens,cache_read_tokens").gte("created_at", monthStart.toISOString()).limit(10000),
    ]);
    if (k) kb = { enabled: k.enabled === true, ...(Object.fromEntries(KNOWLEDGE_FIELDS.map((f) => [f.key, String(k[f.key] ?? "")])) as unknown as Knowledge) };
    for (const r of rows ?? []) {
      usage.count++;
      if (r.status === "usada") usage.used++;
      usage.input += Number(r.input_tokens) || 0;
      usage.output += Number(r.output_tokens) || 0;
      usage.cached += Number(r.cache_read_tokens) || 0;
    }
  }

  return (
    <>
      <PageHeader
        title="Assistente de IA"
        description="Ensine à IA os serviços, preços, portfólio e o jeito de atender da Ponto Digital. Ela sugere respostas no Atendimento; uma pessoa sempre revisa antes de enviar."
        actions={<Badge tone={kb?.enabled ? "green" : "slate"}>{kb?.enabled ? "IA ativa" : "IA desativada"}</Badge>}
      />
      {!isSupabase() && <div className="mb-6"><Notice tone="amber">O assistente de IA funciona com o Supabase conectado.</Notice></div>}
      {isSupabase() && !e.ANTHROPIC_API_KEY && (
        <div className="mb-6">
          <Notice tone="amber" title="IA ainda não conectada no servidor">
            Falta a chave da Anthropic (ANTHROPIC_API_KEY) nas variáveis do Render. Você já pode preencher a base de conhecimento abaixo.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_340px]">
        <KnowledgeForm initial={kb} fields={KNOWLEDGE_FIELDS} canTest={isSupabase() && Boolean(e.ANTHROPIC_API_KEY)} />

        <div className="space-y-6">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-violet-600" /> Níveis de automação</span>} />
            <ol className="divide-y divide-line">
              {LEVELS.map((l) => (
                <li key={l.n} className="px-5 py-3 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    {l.n}. {l.title} {l.on ? <Badge tone="green">Ativo</Badge> : <Badge>Próxima fase · com sua aprovação</Badge>}
                  </p>
                  <p className="mt-0.5 text-[13px] text-slate-500">{l.body}</p>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader title="Uso neste mês" description={`Modelo ${e.AI_MODEL} · limite ${e.AI_LIMITE_MENSAL} sugestões`} />
            <dl className="grid grid-cols-2 gap-3 p-5 text-sm">
              <div><dt className="text-[12px] text-slate-500">Sugestões</dt><dd className="text-xl font-semibold tabular-nums">{usage.count}</dd></div>
              <div><dt className="text-[12px] text-slate-500">Usadas pela equipe</dt><dd className="text-xl font-semibold tabular-nums">{usage.used}</dd></div>
              <div><dt className="text-[12px] text-slate-500">Tokens de entrada</dt><dd className="tabular-nums">{usage.input.toLocaleString("pt-BR")}</dd></div>
              <div><dt className="text-[12px] text-slate-500">Tokens de saída</dt><dd className="tabular-nums">{usage.output.toLocaleString("pt-BR")}</dd></div>
              <div className="col-span-2"><dt className="text-[12px] text-slate-500">Lidos do cache (mais baratos)</dt><dd className="tabular-nums">{usage.cached.toLocaleString("pt-BR")}</dd></div>
            </dl>
            <p className="border-t border-line px-5 py-3 text-[12px] text-slate-500">
              {user.role === "admin" || user.role === "gestor" ? "Inclui as sugestões de toda a equipe." : "Suas sugestões."} O custo é cobrado pela Anthropic conforme o uso.
            </p>
          </Card>

          <Card className="p-5 text-[13px] text-slate-600">
            <p className="mb-2 flex items-center gap-2 font-semibold text-slate-800"><ShieldCheck className="size-4 text-emerald-600" /> Privacidade (LGPD)</p>
            Para sugerir, a IA recebe só o primeiro nome do cliente e as últimas 20 mensagens da conversa — nunca telefone, e-mail ou documentos. As mensagens dos clientes são tratadas como informação, não como ordens.
          </Card>
        </div>
      </div>
    </>
  );
}
