import { connection } from "next/server";
import { Database, FlaskConical } from "lucide-react";
import { env } from "@/lib/env";
import { isSupabase } from "@/lib/supabase/server";

/**
 * Aviso permanente do modo de dados e de envio do WhatsApp. Lido a cada requisição: o texto
 * depende das variáveis do servidor, que podem mudar sem nova compilação (ex.: painel do Render).
 */
export async function DemoBanner() {
  await connection();
  if (isSupabase()) {
    const e = env();
    const live = e.WHATSAPP_SEND_MODE === "live";
    const detail = !live
      ? "Envios de WhatsApp e campanhas continuam apenas simulados."
      : e.WHATSAPP_AMBIENTE === "teste"
        ? "WhatsApp em TESTE: envio real só para os números da equipe."
        : `WhatsApp em PRODUÇÃO: mensagens reais para clientes${e.WHATSAPP_CAMPAIGNS_LIVE ? " (campanhas liberadas)" : "; campanhas simuladas"}.`;
    return (
      <div className={`flex items-center justify-center gap-2 border-b px-4 py-1.5 text-center text-[12.5px] ${live && e.WHATSAPP_AMBIENTE === "producao" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-sky-200 bg-sky-50 text-sky-900"}`}>
        <Database className="size-3.5 shrink-0" />
        <span>
          <strong className="font-semibold">Conectado ao Supabase</strong>
          <span className="hidden sm:inline"> — dados reais. {detail}</span>
          <span className="sm:hidden"> — {live ? (e.WHATSAPP_AMBIENTE === "teste" ? "WhatsApp em teste" : "WhatsApp ativo") : "envios simulados"}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-[12.5px] text-amber-900">
      <FlaskConical className="size-3.5 shrink-0" />
      <span>
        <strong className="font-semibold">Modo demonstração</strong>
        <span className="hidden sm:inline"> — dados fictícios. Envios de WhatsApp e campanhas são apenas simulados.</span>
        <span className="sm:hidden"> — envios simulados</span>
      </span>
    </div>
  );
}
