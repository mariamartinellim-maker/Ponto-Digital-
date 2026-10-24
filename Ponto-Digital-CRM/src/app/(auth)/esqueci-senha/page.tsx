import Link from "next/link";
import { ForgotForm } from "../forms";

export const metadata = { title: "Recuperar senha" };

export default function ForgotPage() {
  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Recuperar senha</h2>
      <p className="mb-8 mt-1.5 text-sm text-slate-500">Enviaremos um link válido por 30 minutos para o seu e-mail.</p>
      <ForgotForm />
      <Link href="/login" className="mt-6 block text-center text-sm font-medium text-brand-600 hover:text-brand-700">
        Voltar ao login
      </Link>
    </>
  );
}
