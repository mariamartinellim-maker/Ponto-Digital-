"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { cn, Notice, Textarea } from "@/components/ui";
import type { VideoAction } from "@/lib/video/rules";
import { videoStepAction, type VideoState } from "./actions";

const LABEL: Record<VideoAction, (redo: boolean) => string> = {
  gerar_avatar: (redo) => (redo ? "Refazer avatar" : "Gerar avatar"),
  enviar_avatar: (redo) => (redo ? "Reenviar avatar ao cliente" : "Enviar avatar ao cliente"),
  gerar_video: (redo) => (redo ? "Refazer vídeo" : "Cliente aprovou: gerar vídeo"),
  enviar_previa: (redo) => (redo ? "Reenviar prévia" : "Enviar prévia (com marca d'água)"),
  confirmar_pagamento: () => "Comprovante recebido: confirmar pagamento",
  enviar_final: () => "Enviar vídeo final (sem marca)",
  cancelar: () => "Cancelar",
};

const PRIMARY: VideoAction[] = ["enviar_avatar", "enviar_previa", "enviar_final", "confirmar_pagamento"];

/** Botões das etapas de um pedido. Os de "refazer" levam o campo de ajustes pedido pelo cliente. */
export function OrderActions({ id, actions, done }: { id: string; actions: VideoAction[]; done: { avatar: boolean; video: boolean; avatarSent: boolean; previewSent: boolean } }) {
  const [state, formAction, pending] = useActionState<VideoState, FormData>(videoStepAction, undefined);
  const redo = (a: VideoAction) =>
    (a === "gerar_avatar" && done.avatar) || (a === "gerar_video" && done.video) || (a === "enviar_avatar" && done.avatarSent) || (a === "enviar_previa" && done.previewSent);
  const canAdjust = actions.some((a) => (a === "gerar_avatar" && done.avatar) || (a === "gerar_video" && done.video));
  if (!actions.length) return null;
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error && <Notice tone="red">{state.error}</Notice>}
      {state?.ok && <Notice tone="green">{state.ok}</Notice>}
      {canAdjust && <Textarea name="adjustments" rows={2} maxLength={1000} placeholder="Ajustes pedidos pelo cliente (opcional, usados ao refazer)" aria-label="Ajustes pedidos pelo cliente" className="text-xs" />}
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <button
            key={a}
            name="step"
            value={a}
            disabled={pending}
            onClick={(e) => {
              if (a === "cancelar" && !confirm("Cancelar este pedido?")) e.preventDefault();
            }}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50",
              a === "cancelar" ? "border-line text-red-600 hover:bg-red-50" : PRIMARY.includes(a) && !redo(a) ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700" : "border-line hover:bg-slate-50",
            )}
          >
            {LABEL[a](redo(a))}
          </button>
        ))}
      </div>
    </form>
  );
}

/** Enquanto houver avatar ou vídeo sendo gerado, atualiza a tela a cada 5 s. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
