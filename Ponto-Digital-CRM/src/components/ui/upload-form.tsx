"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { Button, Notice } from ".";

/** Envio de arquivo para /api/biblioteca (biblioteca de mídias ou comprovantes). */
export function UploadForm({ destino, accept, children, submitLabel, success }: { destino: "biblioteca" | "comprovante"; accept: string; children?: ReactNode; submitLabel: string; success: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<{ error?: string; ok?: boolean }>({});
  const [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setState({});
    const form = new FormData(e.currentTarget);
    form.set("destino", destino);
    const res = await fetch("/api/biblioteca", { method: "POST", body: form }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; redirect?: string } | null;
    setPending(false);
    if (!res?.ok || !data?.ok) return setState({ error: data?.error ?? "Falha no envio. Tente novamente." });
    ref.current?.reset();
    setState({ ok: true });
    if (data.redirect) router.push(data.redirect);
    else router.refresh();
  }
  return (
    <form ref={ref} onSubmit={submit} className="space-y-4">
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{success}</Notice>}
      <input type="file" name="file" accept={accept} required aria-label="Arquivo" className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700" />
      {children}
      <div className="flex justify-end">
        <Button disabled={pending}>{pending ? "Enviando…" : submitLabel}</Button>
      </div>
    </form>
  );
}
