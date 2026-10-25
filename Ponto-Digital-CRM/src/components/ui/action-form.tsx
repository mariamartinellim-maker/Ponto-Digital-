"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { Button, Notice } from ".";

type BaseState = { error?: string; ok?: number | boolean | string };

/** Formulário genérico para Server Actions: mostra erros, mensagem de sucesso e limpa os campos. */
export function ActionForm<S extends BaseState>({
  action,
  children,
  submitLabel,
  success,
  className = "space-y-4",
}: {
  action: (state: S | undefined, formData: FormData) => Promise<S | undefined>;
  children: ReactNode;
  submitLabel: string;
  success?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<S | undefined, FormData>(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {state?.error && <Notice tone="red">{state.error}</Notice>}
      {state?.ok && success && <Notice tone="green">{typeof state.ok === "string" ? state.ok : success}</Notice>}
      {children}
      <div className="flex justify-end">
        <Button disabled={pending}>{pending ? "Salvando…" : submitLabel}</Button>
      </div>
    </form>
  );
}
