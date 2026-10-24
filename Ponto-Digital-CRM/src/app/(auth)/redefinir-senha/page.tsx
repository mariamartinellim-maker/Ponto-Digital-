import { Suspense } from "react";
import { ResetForm } from "../forms";

export const metadata = { title: "Redefinir senha" };

export default function ResetPage() {
  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Definir nova senha</h2>
      <p className="mb-8 mt-1.5 text-sm text-slate-500">Ao salvar, sessões abertas em outros aparelhos serão encerradas.</p>
      <Suspense>
        <ResetForm />
      </Suspense>
    </>
  );
}
