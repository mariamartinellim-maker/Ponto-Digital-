"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Loader2, PauseCircle, QrCode, Smartphone, Unlink } from "lucide-react";
import { Badge, Button, Notice } from "@/components/ui";
import { logoutWaWebAction, pauseWaWebAction, startWaWebAction, type WebActionState } from "./actions";

interface Status {
  status: "desligado" | "iniciando" | "aguardando_qr" | "conectado" | "reconectando" | "bloqueado" | "erro";
  qr: string | null;
  phoneEnd: string | null;
  lastError: string | null;
  connectedAt: string | null;
  received: number;
  ignored: number;
  simulator: boolean;
  ready: boolean;
}

const LABEL: Record<Status["status"], { text: string; tone: "slate" | "amber" | "green" | "red" | "sky" }> = {
  desligado: { text: "Desligado", tone: "slate" },
  iniciando: { text: "Iniciando…", tone: "sky" },
  aguardando_qr: { text: "Aguardando leitura do QR Code", tone: "amber" },
  conectado: { text: "Conectado", tone: "green" },
  reconectando: { text: "Reconectando…", tone: "amber" },
  bloqueado: { text: "Número bloqueado", tone: "red" },
  erro: { text: "Erro", tone: "red" },
};

export function WaWebPanel({ ready }: { ready: boolean }) {
  const [s, setS] = useState<Status | null>(null);
  const [msg, setMsg] = useState<WebActionState>(undefined);
  const [pending, start] = useTransition();

  const refresh = useCallback(async () => {
    const r = await fetch("/api/whatsapp-web/status", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setS((await r.json()) as Status);
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 2000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  const run = (fn: () => Promise<WebActionState>) =>
    start(async () => {
      setMsg(await fn());
      await refresh();
    });

  const st = s?.status ?? "desligado";
  const active = ["iniciando", "aguardando_qr", "conectado", "reconectando"].includes(st);

  return (
    <div className="space-y-4 p-5 text-sm" data-testid="waweb-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={LABEL[st].tone}>
          <span data-testid="waweb-status">{LABEL[st].text}</span>
        </Badge>
        {s?.simulator && <Badge tone="sky">Simulador</Badge>}
        {st === "conectado" && s?.phoneEnd && <span className="text-slate-600">Chip de teste final {s.phoneEnd}</span>}
      </div>

      {msg?.error && <Notice tone="red">{msg.error}</Notice>}
      {s?.lastError && <Notice tone={st === "bloqueado" || st === "erro" ? "red" : "amber"}>{s.lastError}</Notice>}

      {st === "aguardando_qr" && s?.qr && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-white p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR Code gerado no servidor (data URL) */}
          <img src={s.qr} alt="QR Code para vincular o chip de teste" width={264} height={264} data-testid="waweb-qr" />
          <p className="max-w-sm text-center text-[13px] text-slate-600">
            No celular do <b>chip de teste</b>: WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho. O QR Code muda a cada poucos segundos.
          </p>
        </div>
      )}

      {st === "conectado" && (
        <dl className="grid grid-cols-2 gap-3">
          <div><dt className="text-[12px] text-slate-500">Mensagens gravadas</dt><dd className="font-medium tabular-nums" data-testid="waweb-received">{s?.received ?? 0}</dd></div>
          <div><dt className="text-[12px] text-slate-500">Ignoradas (fora do teste, grupos)</dt><dd className="font-medium tabular-nums" data-testid="waweb-ignored">{s?.ignored ?? 0}</dd></div>
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        {!active && (
          <Button type="button" disabled={!ready || pending} onClick={() => run(startWaWebAction)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />} Conectar chip de teste
          </Button>
        )}
        {active && (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run(pauseWaWebAction)}>
            <PauseCircle className="size-4" /> Pausar
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (confirm("Desvincular o aparelho e apagar a sessão salva? Para voltar será preciso ler um novo QR Code.")) run(logoutWaWebAction);
          }}
        >
          <Unlink className="size-4" /> Desvincular e apagar sessão
        </Button>
      </div>
      <p className="flex items-start gap-2 text-[12px] text-slate-500">
        <Smartphone className="mt-0.5 size-3.5 shrink-0" /> Este módulo só recebe mensagens. Respostas pelo CRM seguem as travas da API oficial (simulação por padrão).
      </p>
    </div>
  );
}
