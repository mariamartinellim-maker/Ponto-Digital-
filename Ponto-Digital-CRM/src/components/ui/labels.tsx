import type { ConsentStatus, Stage } from "@/lib/data/types";
import { Badge } from ".";

export function ConsentBadge({ status }: { status: ConsentStatus }) {
  if (status === "opt_in") return <Badge tone="green">Aceita WhatsApp</Badge>;
  if (status === "opt_out") return <Badge tone="red">Descadastrado</Badge>;
  return <Badge tone="amber">Sem consentimento</Badge>;
}

const STAGE_TONE: Record<Stage, "slate" | "brand" | "sky" | "green" | "red"> = {
  novo_lead: "slate",
  em_atendimento: "sky",
  proposta_enviada: "brand",
  fechado: "green",
  perdido: "red",
};
const STAGE_LABEL: Record<Stage, string> = {
  novo_lead: "Novo Lead",
  em_atendimento: "Em Atendimento",
  proposta_enviada: "Proposta Enviada",
  fechado: "Fechado",
  perdido: "Perdido",
};
export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>;
}
