"use client";

import { useEffect, useRef, useState } from "react";
import { QrCode, Smartphone } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { finishCoexistenceAction } from "./actions";

interface FBLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}
interface FBSdk {
  init(o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: FBLoginResponse) => void, o: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FBSdk;
    fbAsyncInit?: () => void;
  }
}

function loadSdk(appId: string, version: string): Promise<FBSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/pt_BR/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Não foi possível carregar o SDK oficial da Meta."));
    document.body.appendChild(s);
  });
}

/**
 * Botão oficial de conexão (Embedded Signup da Meta) no modo de coexistência com o app
 * WhatsApp Business: o QR Code é escaneado NO APP do celular, que continua funcionando.
 */
export function CoexistenceConnect({ appId, configId, graphVersion }: { appId: string; configId: string; graphVersion: string }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error?: string; ok?: string } | null>(null);
  const session = useRef<{ event?: string; phoneNumberId?: string; wabaId?: string; code?: string }>({});

  const tryFinish = async () => {
    const s = session.current;
    if (!s.code || !s.event) return;
    if (!s.phoneNumberId || !s.wabaId) {
      setBusy(false);
      setResult({ error: "A Meta não informou o número conectado. Nada foi alterado. Tente novamente." });
      return;
    }
    const r = await finishCoexistenceAction({ code: s.code, event: s.event, phoneNumberId: s.phoneNumberId, wabaId: s.wabaId });
    session.current = {};
    setBusy(false);
    setResult(r ?? null);
  };

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/.test(ev.origin)) return;
      let data: { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string; current_step?: string; error_message?: string } };
      try {
        data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event === "CANCEL" || data.event === "ERROR") {
        session.current = {};
        setBusy(false);
        setResult({ error: data.event === "CANCEL" ? "Conexão cancelada. Nada foi alterado." : `A Meta informou um erro: ${data.data?.error_message ?? "tente novamente"}. Nada foi alterado.` });
        return;
      }
      session.current.event = data.event;
      session.current.phoneNumberId = data.data?.phone_number_id;
      session.current.wabaId = data.data?.waba_id;
      void tryFinish();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const start = async () => {
    setResult(null);
    setBusy(true);
    try {
      const FB = await loadSdk(appId, graphVersion);
      FB.login(
        (resp) => {
          const code = resp.authResponse?.code;
          if (!code) {
            setBusy(false);
            setResult({ error: "Conexão não concluída na janela da Meta. Nada foi alterado." });
            return;
          }
          session.current.code = code;
          void tryFinish();
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          // Fluxo de coexistência: o número continua no app WhatsApp Business.
          extras: { setup: {}, featureType: "whatsapp_business_app_onboarding" },
        },
      );
    } catch (err) {
      setBusy(false);
      setResult({ error: err instanceof Error ? err.message : "Falha ao abrir a janela da Meta." });
    }
  };

  return (
    <div className="space-y-3">
      {result?.error && <Notice tone="red">{result.error}</Notice>}
      {result?.ok && <Notice tone="green">{result.ok}</Notice>}
      <ol className="list-inside list-decimal space-y-1 text-[13px] text-slate-600">
        <li>Deixe o celular com o <b>WhatsApp Business</b> por perto, atualizado e conectado à internet.</li>
        <li>Clique no botão abaixo e entre com o Facebook da Ponto Digital (administrador do portfólio empresarial).</li>
        <li>Escolha a opção de conectar o <b>app WhatsApp Business existente</b> e informe o número.</li>
        <li>No celular, abra o WhatsApp Business e escaneie o <b>QR Code</b> que aparecer. Escolha se quer compartilhar o histórico de conversas.</li>
      </ol>
      <label className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 ring-1 ring-amber-200">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 accent-amber-600" />
        <span>
          Entendo que esta é a conexão oficial da Meta em <b>coexistência</b>: o número continua no app do celular; aparelhos vinculados
          (WhatsApp Web/computador) são desconectados e podem ser vinculados de novo; e mensagens enviadas pela API são cobradas pela Meta.
        </span>
      </label>
      <Button onClick={start} disabled={!agree || busy} className="w-full sm:w-auto">
        {busy ? <><Smartphone className="size-4 animate-pulse" /> Aguardando a Meta…</> : <><QrCode className="size-4" /> Conectar meu WhatsApp Business (coexistência)</>}
      </Button>
    </div>
  );
}
