import { Database, FlaskConical } from "lucide-react";
import { isSupabase } from "@/lib/supabase/server";

/** Aviso permanente do modo de dados. Em ambos, nenhuma mensagem real de WhatsApp é enviada. */
export function DemoBanner() {
  if (isSupabase()) {
    return (
      <div className="flex items-center justify-center gap-2 border-b border-sky-200 bg-sky-50 px-4 py-1.5 text-center text-[12.5px] text-sky-900">
        <Database className="size-3.5 shrink-0" />
        <span>
          <strong className="font-semibold">Conectado ao Supabase</strong>
          <span className="hidden sm:inline"> — dados reais. Envios de WhatsApp e campanhas continuam apenas simulados.</span>
          <span className="sm:hidden"> — envios simulados</span>
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

/** Módulos ainda não migrados para o Supabase: leitura liberada, gravação na próxima etapa. */
export function ReadOnlyNotice() {
  if (!isSupabase()) return null;
  return (
    <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" role="status">
      <strong className="font-semibold">Somente leitura no Supabase.</strong> Você pode consultar este módulo; criar e alterar
      registros aqui será liberado na próxima etapa da integração.
    </div>
  );
}
