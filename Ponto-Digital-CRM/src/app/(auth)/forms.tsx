"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { loginAction, requestResetAction, resetPasswordAction } from "./actions";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state?.error && <Notice tone="red">{state.error}</Notice>}
      <Field label="E-mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required placeholder="voce@pontodigital.com.br" />
      </Field>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="password" className="text-[13px] font-medium text-slate-700">Senha</label>
          <Link href="/esqueci-senha" className="text-[13px] font-medium text-brand-600 hover:text-brand-700">
            Esqueci minha senha
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestResetAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Notice tone="red">{state.error}</Notice>}
      {state?.ok && <Notice tone="green">{state.ok}</Notice>}
      <Field label="E-mail cadastrado" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Enviando…" : "Enviar link de redefinição"}
      </Button>
    </form>
  );
}

export function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  if (state?.ok) {
    return (
      <div className="space-y-4">
        <Notice tone="green">{state.ok}</Notice>
        <Link href="/login" className="block text-center text-sm font-medium text-brand-600">Ir para o login</Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {!token && <Notice tone="amber">Link incompleto. Abra o link recebido por e-mail.</Notice>}
      {state?.error && <Notice tone="red">{state.error}</Notice>}
      <Field label="Nova senha" htmlFor="password" hint="Mínimo de 10 caracteres, com letras e números.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Confirmar nova senha" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Button type="submit" className="w-full" disabled={pending || !token}>
        {pending ? "Salvando…" : "Salvar nova senha"}
      </Button>
    </form>
  );
}
