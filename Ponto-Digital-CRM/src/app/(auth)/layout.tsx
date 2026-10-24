import { Logo } from "@/components/layout/logo";
import { BarChart3, MessagesSquare, ShieldCheck } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink-950 p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-32 -top-32 size-[520px] rounded-full bg-brand-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-[-120px] size-[420px] rounded-full bg-coral-500/20 blur-3xl" />
        <div className="relative">
          <Logo dark />
        </div>
        <div className="relative mt-auto max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Relacionamento que vira resultado<span className="text-coral-500">.</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Clientes, funil comercial, atendimento no WhatsApp e campanhas em um só lugar — com segurança e em conformidade com a LGPD.
          </p>
          <ul className="mt-10 space-y-4 text-sm text-white/75">
            <li className="flex items-center gap-3"><MessagesSquare className="size-5 text-brand-300" /> Atendimento pela API oficial do WhatsApp</li>
            <li className="flex items-center gap-3"><BarChart3 className="size-5 text-brand-300" /> Indicadores de vendas e campanhas em tempo real</li>
            <li className="flex items-center gap-3"><ShieldCheck className="size-5 text-brand-300" /> Consentimento, descadastro e auditoria</li>
          </ul>
        </div>
        <p className="relative mt-16 text-xs text-white/30">© Ponto Digital — Agência de Marketing</p>
      </section>
      <main className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
