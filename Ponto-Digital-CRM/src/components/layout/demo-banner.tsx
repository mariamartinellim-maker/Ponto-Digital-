import { FlaskConical } from "lucide-react";

/** Aviso permanente: modo demonstração, nenhuma mensagem real é enviada. */
export function DemoBanner() {
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
