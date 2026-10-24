import type { Client, Deal, Segment, Stage } from "./data/types";

export interface AudienceResult {
  eligible: Client[];
  excludedNoConsent: Client[];
  excludedOptOut: Client[];
}

/**
 * Seleciona o público de uma campanha. Regras LGPD / políticas da Meta:
 * somente contatos com consentimento explícito (opt-in) recebem; descadastrados nunca recebem.
 */
export function resolveAudience(segment: Segment, clients: Client[], deals: Deal[]): AudienceResult {
  const stagesByClient = new Map<string, Set<Stage>>();
  for (const d of deals) {
    if (!stagesByClient.has(d.clientId)) stagesByClient.set(d.clientId, new Set());
    stagesByClient.get(d.clientId)!.add(d.stage);
  }
  const lc = (s: string) => s.trim().toLowerCase();
  const cities = segment.cities.map(lc);
  const matches = clients.filter((c) => {
    if (cities.length && !cities.includes(lc(c.city))) return false;
    if (segment.services.length && !segment.services.some((s) => c.services.includes(s))) return false;
    if (segment.tags.length && !segment.tags.some((t) => c.tags.includes(t))) return false;
    if (segment.stages.length) {
      const st = stagesByClient.get(c.id);
      if (!st || !segment.stages.some((s) => st.has(s))) return false;
    }
    return true;
  });
  return {
    eligible: matches.filter((c) => c.consent.status === "opt_in"),
    excludedNoConsent: matches.filter((c) => c.consent.status === "desconhecido"),
    excludedOptOut: matches.filter((c) => c.consent.status === "opt_out"),
  };
}

/** Preenche variáveis {{1}}, {{2}}… de um template. */
export function renderTemplate(body: string, vars: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[Number(n) - 1] ?? `{{${n}}}`);
}

export function templateVariableCount(body: string) {
  const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

/** Palavras que indicam pedido de descadastro (opt-out) em mensagens recebidas. */
const OPT_OUT = ["sair", "parar", "pare", "stop", "descadastrar", "cancelar inscricao", "nao quero receber"];
export function isOptOutMessage(text: string) {
  const t = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.!?]+$/, "");
  return OPT_OUT.includes(t);
}
