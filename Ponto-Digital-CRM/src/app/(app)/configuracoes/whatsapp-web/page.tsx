import { AlertTriangle, CheckCircle2, Circle, FlaskConical, ShieldCheck } from "lucide-react";
import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { isSupabase } from "@/lib/supabase/server";
import { wawebConfig } from "@/lib/whatsapp-web/manager";
import { WaWebPanel } from "./panel";

export const metadata = { title: "WhatsApp Web (experimental)" };
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

export default async function WhatsAppWebPage() {
  await requireUser("settings:manage");
  const cfg = wawebConfig();

  return (
    <>
      <PageHeader
        title="WhatsApp Web (experimental)"
        description="Conexão por QR Code para testes com um chip de teste. Não oficial e separada da integração oficial da Meta."
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone="amber">Experimental</Badge>
            <Badge tone="sky">Somente recebimento</Badge>
          </div>
        }
      />
      <div className="mb-6">
        <Notice tone="amber" title="Use apenas um chip de teste, nunca o número principal">
          Esta conexão usa o protocolo do WhatsApp Web sem autorização da Meta: pode parar de funcionar a qualquer momento e o número vinculado pode ser
          banido. Para atender clientes, use a integração oficial em WhatsApp Business. Números fora da lista de teste são desvinculados automaticamente.
        </Notice>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><FlaskConical className="size-4 text-brand-600" /> Conexão do chip de teste</span>} />
          {cfg.ready ? (
            <WaWebPanel ready={cfg.ready} />
          ) : (
            <div className="space-y-3 p-5 text-sm">
              <p className="text-slate-600">O módulo está desligado. Para ligar, o servidor precisa de:</p>
              <ul className="divide-y divide-line">
                <Item ok={cfg.enabled} label="WAWEB_HABILITADO=true" hint="Liga o módulo experimental." />
                <Item ok={cfg.allowed.length > 0} label="WAWEB_NUMEROS_PERMITIDOS" hint="Chip(s) de teste que podem ser vinculados, com DDI e DDD." />
                <Item ok={!cfg.missing.includes("WAWEB_SESSION_KEY")} label="WAWEB_SESSION_KEY" hint="Criptografa a sessão salva (gere com npm run whatsapp:chave)." />
                {isSupabase() && <Item ok={!cfg.missing.includes("SUPABASE_SECRET_KEY")} label="SUPABASE_SECRET_KEY" hint="Guarda a sessão no banco para sobreviver aos deploys." />}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-brand-600" /> Travas de segurança</span>} />
          <ul className="divide-y divide-line px-5 py-2">
            <Item ok label={`Só vincula ${cfg.allowed.length} chip(s) de teste autorizado(s)`} hint="Qualquer outro número é desvinculado na hora e a sessão é apagada." />
            <Item ok label={`Só grava mensagens de ${cfg.contacts.length} contato(s) de teste`} hint="WAWEB_CONTATOS_TESTE (ou WHATSAPP_NUMEROS_TESTE). Os demais são ignorados sem gravar." />
            <Item ok label="Nenhum envio por esta conexão" hint="O módulo não tem função de envio; respostas seguem as travas da API oficial." />
            <Item ok label="Grupos, listas de transmissão e status são ignorados" />
            <Item ok label="Não baixa o histórico do celular e não aparece online" />
            <Item ok label="Sessão criptografada (AES-256-GCM), retomada após reinícios" />
          </ul>
        </Card>
      </div>

      <Card className="mt-6 p-5 text-[13px] text-slate-600">
        <p className="mb-1 flex items-center gap-2 font-semibold text-slate-800"><AlertTriangle className="size-4 text-amber-600" /> Limitações</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>Não oficial: atualizações do WhatsApp podem interromper a conexão até a biblioteca ser atualizada.</li>
          <li>O celular do chip precisa entrar na internet periodicamente; após cerca de 14 dias offline o aparelho é desvinculado.</li>
          <li>Ocupa uma das 4 vagas de aparelhos conectados. Imagens, áudios e documentos aparecem como descrição, sem o arquivo.</li>
          <li>Durante um deploy ou reinício do servidor a conexão fica fora do ar por alguns segundos e volta sozinha.</li>
        </ul>
      </Card>
    </>
  );
}
