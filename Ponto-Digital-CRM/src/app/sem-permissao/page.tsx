import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { buttonClass } from "@/components/ui";

export const metadata = { title: "Sem permissão" };

export default function NoPermission() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-coral-50 text-coral-600">
        <ShieldAlert className="size-6" />
      </div>
      <h1 className="text-xl font-semibold">Acesso não permitido</h1>
      <p className="max-w-sm text-sm text-slate-500">Seu perfil não tem permissão para esta área. Fale com o administrador da conta.</p>
      <Link href="/dashboard" className={buttonClass("outline")}>Voltar ao dashboard</Link>
    </main>
  );
}
