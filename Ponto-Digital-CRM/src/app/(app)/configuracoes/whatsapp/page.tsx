import { CheckCircle2, Circle, Lock, ShieldCheck, Smartphone, Webhook } from "lucide-react";
import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { env, integrationStatus } from "@/lib/env";

export const metadata = { title: "WhatsApp Business" };
export const instant = false;

function Item({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-3 py-2">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 size-4 shrink-0 text-slate-300" />}
      <span>
        <span className="text-sm text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </li>
  );
}

const STEPS: { title: string; body: string; approval?: boolean }[] = [
  { title: "Confirmar elegibilidade da coexistência", body: "Verificar com um Parceiro de Soluções (BSP/Tech Provider) da Meta se o seu número do App WhatsApp Business pode usar a coexistência (país, versão do app, tempo de uso e atividade do número)." },
  { title: "Criar o app na Meta for Developers e a conta empresarial (WABA)", body: "Business Manager verificado, app do tipo Business com o produto WhatsApp. Nada é alterado no seu número nesta etapa." },
  { title: "Configurar webhook e segredos no servidor", body: "Cadastrar a URL do webhook, o token de verificação e o App Secret como variáveis de ambiente (nunca no código). Assinar os campos messages, smb_message_echoes, history e smb_app_state_sync." },
  { title: "Onboarding por Embedded Signup com coexistência", body: "Você escaneia o QR Code no App WhatsApp Business para conectar o MESMO número à Cloud API. O app continua funcionando no celular.", approval: true },
  { title: "Autorizar (ou não) a sincronização de histórico", body: "Durante o onboarding, o app pergunta se deseja compartilhar o histórico de conversas (até ~6 meses). As mensagens chegam pelo webhook “history”.", approval: true },
  { title: "Testes controlados", body: "Envio para números internos da equipe, com modo live apenas para mensagens individuais. Campanhas permanecem em simulação.", approval: true },
  { title: "Liberar campanhas reais", body: "Somente após a sua aprovação expressa, revisão dos modelos e conferência dos custos por conversa da Meta.", approval: true },
];

export default async function WhatsAppSettingsPage() {
  await requireUser("settings:manage");
  const s = integrationStatus();
  const w = s.whatsapp;
  const webhookUrl = `${env().APP_URL}/api/webhooks/whatsapp`;

  return (
    <>
      <PageHeader
        title="WhatsApp Business"
        description="Integração oficial pela WhatsApp Cloud API (Meta), com coexistência entre o aplicativo WhatsApp Business e o CRM."
        actions={<Badge tone={w.sendMode === "live" ? "red" : "amber"}>{w.sendMode === "live" ? "Envio real ATIVO" : "Modo simulação"}</Badge>}
      />
      <div className="mb-6">
        <Notice tone="brand" title="Seu número e suas conversas estão preservados">
          Nenhuma ação foi feita no seu número. A conexão só acontece quando você mesmo(a) escanear o QR Code no aplicativo, na etapa de integração — e somente após a sua aprovação. Não usamos APIs não oficiais nem automações de WhatsApp Web.
        </Notice>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Webhook className="size-4 text-brand-600" /> Webhook</span>} description="Endereço que a Meta chama para entregar mensagens e status." />
          <div className="space-y-3 p-5 text-sm">
            <div>
              <p className="text-[13px] text-slate-500">URL de callback</p>
              <code className="mt-1 block break-all rounded-lg bg-slate-50 px-3 py-2 text-[13px]">{webhookUrl}</code>
              <p className="mt-1 text-xs text-slate-500">Em produção precisa ser HTTPS público (ex.: endereço no Render).</p>
            </div>
            <ul className="divide-y divide-line">
              <Item ok={w.hasVerifyToken} label="Token de verificação (WHATSAPP_VERIFY_TOKEN)" hint="Usado no handshake GET de cadastro do webhook." />
              <Item ok={w.hasAppSecret} label="App Secret (WHATSAPP_APP_SECRET)" hint="Valida a assinatura X-Hub-Signature-256 de cada evento. Sem ele, eventos são recusados." />
              <Item ok={w.hasAccessToken} label="Token de acesso do sistema (WHATSAPP_ACCESS_TOKEN)" hint="Token de usuário do sistema com permissões whatsapp_business_messaging/management." />
              <Item ok={w.hasPhoneNumberId} label="ID do número (WHATSAPP_PHONE_NUMBER_ID)" />
              <Item ok={w.hasWabaId} label="ID da conta WhatsApp Business (WHATSAPP_WABA_ID)" />
            </ul>
            <p className="text-xs text-slate-500">Graph API: {w.graphVersion}. Os valores dos segredos nunca são exibidos aqui.</p>
          </div>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-brand-600" /> Travas de segurança</span>} />
          <ul className="divide-y divide-line px-5 py-2">
            <Item ok={w.sendMode === "simulacao"} label="Mensagens individuais em simulação (WHATSAPP_SEND_MODE=simulacao)" hint="Nada é enviado ao WhatsApp enquanto estiver neste modo." />
            <Item ok={!w.campaignsLive} label="Campanhas bloqueadas para envio real (WHATSAPP_CAMPAIGNS_LIVE=false)" hint="Nesta versão, campanhas reais são recusadas mesmo que a variável seja alterada." />
            <Item ok label="Somente contatos com opt-in recebem campanhas" />
            <Item ok label="Palavras SAIR / PARAR / STOP descadastram automaticamente" />
            <Item ok label="Mensagens livres só dentro da janela de 24h (regra da Meta)" />
            <Item ok label="Webhooks idempotentes (mensagens duplicadas são ignoradas)" />
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title={<span className="flex items-center gap-2"><Smartphone className="size-4 text-brand-600" /> Plano de integração com coexistência</span>} description="Etapas marcadas com cadeado só acontecem com a sua autorização expressa." />
        <ol className="divide-y divide-line">
          {STEPS.map((st, i) => (
            <li key={st.title} className="flex gap-4 px-5 py-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[13px] font-semibold text-brand-700">{i + 1}</span>
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  {st.title}
                  {st.approval && <Badge tone="amber"><Lock className="size-3" /> Requer sua aprovação</Badge>}
                </p>
                <p className="mt-0.5 text-[13px] text-slate-600">{st.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
