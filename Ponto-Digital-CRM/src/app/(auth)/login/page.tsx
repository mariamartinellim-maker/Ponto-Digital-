import { Suspense } from "react";
import { LoginForm } from "../forms";

export const metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Bem-vindo(a) de volta</h2>
      <p className="mb-8 mt-1.5 text-sm text-slate-500">Acesse o CRM da Ponto Digital com seu e-mail e senha.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-8 text-center text-xs text-slate-400">
        Acesso restrito à equipe. Novos usuários são criados pelo administrador.
      </p>
    </>
  );
}
