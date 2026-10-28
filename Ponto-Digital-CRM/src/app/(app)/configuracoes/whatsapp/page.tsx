import { CheckCircle2, Circle, Link2, Lock, RefreshCw, ShieldCheck, Smartphone, UserRound, Webhook } from "lucide-react";
import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";
import { env, integrationStatus } from "@/lib/env";
import { formatDateTime, requestTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { hasSupabaseAdmin, supabaseAdmin } from "@/lib/supabase/admin";
import { isSupabase, supabaseServer } from "@/lib/supabase/server";
import { linkEnvNumberAction, retrySyncAction } from "./actions";
import { waCredentials } from "@/lib/whatsapp/client";
import { getBusinessProfile, PROFILE_DEFAULTS, VERTICALS, type BusinessProfile } from "@/lib/whatsapp/profile";
import { CoexistenceConnect } from "./coexistence-connect";
import { ProfileForm } from "./profile-form";

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

const WEBHOOK_FIELDS = [
  ["messages", "mensagens recebidas e status de entrega"],
  ["smb_message_echoes", "mensagens que você envia pelo app no celular"],
  ["history", "histórico de conversas (se você autorizar)"],
  ["smb_app_state_sync", "contatos do app"],
  ["message_template_status_update", "aprovação dos modelos"],
] as const;

const HISTORY: Record<string, string> = {
  pendente: "aguardando",
  recebendo: "recebendo",
  concluido: "concluída",
  recusado: "não autorizada no app",
  erro: "com erro",
};

interface Account {
  coexistence: boolean;
  phone_number_id: string;
  waba_id: string;
  display_phone: string;
  verified_name: string;
  onboarded_at: string;
  contacts_sync_requested_at: string | null;
  history_sync_requested_at: string | null;
  history_status: string;
  last_error: string | null;
}

export default async function WhatsAppSettingsPage() {
  const user = await requireUser("settings:manage");
  const s = integrationStatus();
  const w = s.whatsapp;
  const e = env();
  const webhookUrl = `${e.APP_URL}/api/webhooks/whatsapp`;

  let account: Account | null = null;
  let linkedPhoneId: string | null = null;
  let lastWebhook: string | null = null;
  if (isSupabase()) {
    const sb = await supabaseServer();
    const [{ data: org }, { data: hook }] = await Promise.all([
      sb.from("organizations").select("wa_phone_number_id").eq("id", user.orgId).maybeSingle(),
      sb.from("webhook_events").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    linkedPhoneId = org?.wa_phone_number_id ? String(org.wa_phone_number_id) : null;
    lastWebhook = hook?.received_at ? String(hook.received_at) : null;
    if (hasSupabaseAdmin()) {
      const { data } = await supabaseAdmin()
        .from("whatsapp_accounts")
        .select("phone_number_id,waba_id,display_phone,verified_name,coexistence,onboarded_at,contacts_sync_requested_at,history_sync_requested_at,history_status,last_error")
        .eq("org_id", user.orgId)
        .maybeSingle();
      account = (data as Account | null) ?? null;
    }
  }
  const connected = Boolean(account || linkedPhoneId);
  // Perfil comercial atual na Meta; campos vazios recebem o perfil sugerido.
  let profile: BusinessProfile | null = null;
  let photoUrl: string | null = null;
  const creds = await waCredentials(user.orgId);
  if (creds) {
    const cur = await getBusinessProfile(creds.phoneNumberId, creds.token).catch(() => null);
    photoUrl = cur?.profile_picture_url ?? null;
    profile = {
      about: cur?.about || PROFILE_DEFAULTS.about,
      description: cur?.description || PROFILE_DEFAULTS.description,
      vertical: cur?.vertical && cur.vertical in VERTICALS ? cur.vertical : PROFILE_DEFAULTS.vertical,
      address: cur?.address || PROFILE_DEFAULTS.address,
      email: cur?.email || PROFILE_DEFAULTS.email,
      websites: cur?.websites?.length ? cur.websites : PROFILE_DEFAULTS.websites,
    };
  }
  const syncWindowOpen = account ? requestTime() - new Date(account.onboarded_at).getTime() < 24 * 3600_000 : false;

  return (
    <>
      <PageHeader
        title="WhatsApp Business"
        description="Integração oficial pela WhatsApp Cloud API (Meta) em coexistência: o mesmo número no app do celular e no CRM."
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={connected ? "green" : "slate"}>{connected ? "Número conectado" : "Não conectado"}</Badge>
            <Badge tone={w.sendMode === "live" ? "red" : "amber"}>{w.sendMode === "live" ? "Envio real ATIVO" : "Modo simulação"}</Badge>
            <Badge tone={w.environment === "producao" ? "red" : "sky"}>{w.environment === "producao" ? "Produção" : "Ambiente de teste"}</Badge>
          </div>
        }
      />
      <div className="mb-6">
        <Notice tone="brand" title="Seu número e suas conversas estão preservados">
          Esta integração usa somente a conexão oficial da Meta em coexistência: o WhatsApp Business continua no seu celular e nada é migrado. A conexão só
          acontece quando um administrador clica no botão e você escaneia o QR Code no app. O módulo experimental de WhatsApp Web (não oficial) fica separado,
          em outra tela, desligado por padrão e restrito a chips de teste.
        </Notice>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Smartphone className="size-4 text-brand-600" /> Conexão do número</span>} />
          <div className="space-y-4 p-5 text-sm">
            {account ? (
              <>
                <dl className="grid grid-cols-2 gap-3">
                  <div><dt className="text-[12px] text-slate-500">Número</dt><dd className="font-medium tabular-nums">{account.display_phone ? formatPhone(account.display_phone.replace(/\D/g, "")) : account.phone_number_id}</dd></div>
                  <div><dt className="text-[12px] text-slate-500">Nome verificado</dt><dd>{account.verified_name || "—"}</dd></div>
                  <div className="col-span-2">
                    <dt className="text-[12px] text-slate-500">Coexistência com o app WhatsApp Business</dt>
                    <dd>{account.coexistence ? <Badge tone="green">Confirmada pela Meta — o app continua no celular</Badge> : <Badge tone="amber">Não confirmada pela Meta</Badge>}</dd>
                  </div>
                  <div><dt className="text-[12px] text-slate-500">Conectado em</dt><dd>{formatDateTime(account.onboarded_at)}</dd></div>
                  <div><dt className="text-[12px] text-slate-500">Histórico</dt><dd>{HISTORY[account.history_status] ?? account.history_status}</dd></div>
                  <div><dt className="text-[12px] text-slate-500">Contatos</dt><dd>{account.contacts_sync_requested_at ? "solicitados" : "não solicitados"}</dd></div>
                  <div><dt className="text-[12px] text-slate-500">Último evento recebido</dt><dd>{lastWebhook ? formatDateTime(lastWebhook) : "nenhum ainda"}</dd></div>
                </dl>
                {account.last_error && <Notice tone="amber">{account.last_error}</Notice>}
                {syncWindowOpen && (!account.contacts_sync_requested_at || !account.history_sync_requested_at) && (
                  <div className="flex flex-wrap gap-2">
                    {!account.contacts_sync_requested_at && (
                      <ActionForm action={retrySyncAction} submitLabel="Pedir contatos" success="Solicitado." className="contents">
                        <input type="hidden" name="type" value="smb_app_state_sync" />
                      </ActionForm>
                    )}
                    {!account.history_sync_requested_at && (
                      <ActionForm action={retrySyncAction} submitLabel="Pedir histórico" success="Solicitado." className="contents">
                        <input type="hidden" name="type" value="history" />
                      </ActionForm>
                    )}
                  </div>
                )}
                <p className="text-[12px] text-slate-500">
                  Para desconectar: no celular, WhatsApp Business → Configurações → Conta → Plataforma comercial (Business Platform) → Desconectar. O app continua funcionando.
                </p>
              </>
            ) : linkedPhoneId ? (
              <Notice tone="green">Número vinculado pelas variáveis do servidor (ID {linkedPhoneId}).</Notice>
            ) : !isSupabase() ? (
              <Notice tone="amber">A conexão do WhatsApp exige o Supabase conectado.</Notice>
            ) : w.embeddedSignup && s.hasSupabaseSecret && w.hasTokenKey && w.hasAppSecret ? (
              <CoexistenceConnect appId={e.META_APP_ID!} configId={e.META_ES_CONFIG_ID!} graphVersion={e.WHATSAPP_GRAPH_VERSION} />
            ) : (
              <>
                <p className="text-slate-600">Para mostrar o botão de conexão, o servidor precisa de:</p>
                <ul className="divide-y divide-line">
                  <Item ok={s.hasSupabaseSecret} label="SUPABASE_SECRET_KEY" hint="Grava as mensagens recebidas (o webhook não tem usuário logado)." />
                  <Item ok={Boolean(e.META_APP_ID)} label="META_APP_ID" hint="ID do app da Ponto Digital na Meta for Developers." />
                  <Item ok={Boolean(e.META_ES_CONFIG_ID)} label="META_ES_CONFIG_ID" hint="Configuração do Embedded Signup (Login do Facebook para Empresas)." />
                  <Item ok={w.hasAppSecret} label="WHATSAPP_APP_SECRET" hint="Chave secreta do app: valida os webhooks e conclui a conexão." />
                  <Item ok={w.hasTokenKey} label="WHATSAPP_TOKEN_KEY" hint="Criptografa o token da conexão no banco (gere com npm run whatsapp:chave)." />
                </ul>
                {w.hasAccessToken && w.hasPhoneNumberId && s.hasSupabaseSecret && (
                  <div className="border-t border-line pt-4">
                    <p className="mb-2 text-[13px] text-slate-600">
                      <Link2 className="mr-1 inline size-3.5" /> Já há um número nas variáveis do servidor (ex.: conectado por um parceiro da Meta). Vincule-o a esta organização:
                    </p>
                    <ActionForm action={linkEnvNumberAction} submitLabel="Vincular número do servidor" success="Vinculado." className="flex justify-start">
                      <span />
                    </ActionForm>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-brand-600" /> Travas de segurança</span>} />
          <ul className="divide-y divide-line px-5 py-2">
            <Item ok={w.sendMode === "simulacao"} label={w.sendMode === "simulacao" ? "Envio em simulação (WHATSAPP_SEND_MODE=simulacao)" : "Envio REAL ligado (WHATSAPP_SEND_MODE=live)"} hint="Em simulação, nada é enviado ao WhatsApp." />
            <Item ok={w.environment === "teste"} label={w.environment === "teste" ? `Ambiente de teste: envio real só para ${w.testNumbers} número(s) da equipe` : "Ambiente de PRODUÇÃO: envio para clientes reais"} hint="WHATSAPP_AMBIENTE e WHATSAPP_NUMEROS_TESTE." />
            <Item ok={!w.campaignsLive} label={w.campaignsLive ? "Campanhas reais LIBERADAS (WHATSAPP_CAMPAIGNS_LIVE=true)" : "Campanhas sempre simuladas (WHATSAPP_CAMPAIGNS_LIVE=false)"} />
            <Item ok label="Somente contatos com opt-in recebem campanhas (verificado também no banco)" />
            <Item ok label="SAIR / PARAR / STOP descadastram automaticamente" />
            <Item ok label="Texto livre só dentro da janela de 24h (regra da Meta)" />
            <Item ok label="Webhooks com assinatura validada e sem duplicidade" />
            <Item ok label="IA apenas sugere: nenhuma resposta automática é enviada" />
          </ul>
        </Card>

        {profile && (
          <Card className="xl:col-span-2">
            <CardHeader title={<span className="flex items-center gap-2"><UserRound className="size-4 text-brand-600" /> Perfil do WhatsApp</span>} description="Foto, recado, descrição e Instagram que os clientes veem no número oficial." />
            <ProfileForm profile={profile} verticals={VERTICALS} photoUrl={photoUrl} />
          </Card>
        )}

        <Card className="xl:col-span-2">
          <CardHeader title={<span className="flex items-center gap-2"><Webhook className="size-4 text-brand-600" /> Webhook (configurar no app da Meta)</span>} description="Meta for Developers → seu app → WhatsApp → Configuração." />
          <div className="grid grid-cols-1 gap-6 p-5 text-sm lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <p className="text-[13px] text-slate-500">URL de callback</p>
                <code className="mt-1 block break-all rounded-lg bg-slate-50 px-3 py-2 text-[13px]">{webhookUrl}</code>
              </div>
              <ul className="divide-y divide-line">
                <Item ok={w.hasVerifyToken} label="Token de verificação (WHATSAPP_VERIFY_TOKEN)" hint="O mesmo valor vai no campo “Verificar token” da Meta." />
                <Item ok={w.hasAppSecret} label="Chave secreta do app (WHATSAPP_APP_SECRET)" hint="Sem ela, todo evento é recusado." />
                <Item ok={s.hasSupabaseSecret} label="Gravação no banco (SUPABASE_SECRET_KEY)" />
              </ul>
            </div>
            <div>
              <p className="mb-1 text-[13px] text-slate-500">Campos do webhook a assinar</p>
              <ul className="space-y-1.5">
                {WEBHOOK_FIELDS.map(([f, label]) => (
                  <li key={f} className="flex items-start gap-2"><RefreshCw className="mt-0.5 size-3.5 text-brand-500" /><span><code className="text-[12.5px]">{f}</code> <span className="text-slate-500">— {label}</span></span></li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-500">Graph API {w.graphVersion}. Os valores dos segredos nunca são exibidos aqui.</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-5 text-[13px] text-slate-600">
        <p className="mb-1 flex items-center gap-2 font-semibold text-slate-800"><Lock className="size-4 text-amber-600" /> O que muda no app com a coexistência (regras da Meta)</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>O app continua no celular com as mesmas conversas; é preciso abri-lo ao menos a cada 14 dias para manter a conexão.</li>
          <li>Aparelhos vinculados (WhatsApp Web/computador) são desconectados na conexão e podem ser vinculados de novo; WhatsApp para Windows e relógios não repassam mensagens ao CRM.</li>
          <li>Histórico: até 6 meses de conversas individuais, uma única vez, se você autorizar no app. Grupos não são sincronizados.</li>
          <li>Mensagens temporárias e de visualização única ficam desativadas; listas de transmissão viram somente leitura; editar/apagar mensagem não é repassado.</li>
          <li>Mensagens enviadas pelo app continuam gratuitas; as enviadas pela API seguem a tabela de preços da Meta.</li>
        </ul>
      </Card>
    </>
  );
}
