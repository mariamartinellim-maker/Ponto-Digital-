import { Logo } from "@/components/layout/logo";

export const metadata = { title: "Política de Privacidade" };

// Página pública exigida pela Meta para publicar o app do WhatsApp (URL da Política de Privacidade).
export default function Privacidade() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-12">
      <Logo />
      <h1 className="text-2xl font-semibold">Política de Privacidade</h1>
      <div className="space-y-4 text-sm leading-relaxed text-slate-600">
        <p>
          A Ponto Digital usa este sistema (Ponto Digital CRM) para atender os clientes que entram em contato pelo WhatsApp e
          pelos demais canais da empresa.
        </p>
        <h2 className="text-base font-semibold text-slate-900">Dados que coletamos</h2>
        <p>
          Nome, número de telefone, mensagens trocadas com a empresa, arquivos enviados pelo próprio cliente (como imagens e
          comprovantes) e os dados de pedidos, pagamentos e produção ligados ao atendimento.
        </p>
        <h2 className="text-base font-semibold text-slate-900">Como usamos</h2>
        <p>
          Somente para responder ao cliente, registrar o atendimento, processar pedidos e pagamentos e cumprir obrigações
          legais. Não vendemos nem compartilhamos dados pessoais com terceiros para fins de publicidade.
        </p>
        <h2 className="text-base font-semibold text-slate-900">Armazenamento e segurança</h2>
        <p>
          Os dados ficam em servidores com acesso restrito à equipe autorizada da Ponto Digital, com conexão criptografada.
          Mensagens de WhatsApp são processadas pela plataforma oficial da Meta (WhatsApp Business).
        </p>
        <h2 className="text-base font-semibold text-slate-900">Seus direitos</h2>
        <p>
          Conforme a LGPD, você pode pedir acesso, correção ou exclusão dos seus dados e deixar de receber mensagens a
          qualquer momento, respondendo &quot;SAIR&quot; no WhatsApp ou falando com a nossa equipe pelo mesmo canal.
        </p>
      </div>
    </main>
  );
}
