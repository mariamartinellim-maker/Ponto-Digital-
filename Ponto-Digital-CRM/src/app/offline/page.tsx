import { WifiOff } from "lucide-react";
import { Logo } from "@/components/layout/logo";

export const metadata = { title: "Sem conexão" };

export default function Offline() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <WifiOff className="size-6" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">Você está sem conexão</h1>
        <p className="mt-1 text-sm text-slate-500">Os dados do CRM não ficam salvos no aparelho por segurança. Reconecte para continuar.</p>
      </div>
    </main>
  );
}
