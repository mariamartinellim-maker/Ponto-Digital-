import type { Campaign } from "./data/types";

export function campaignStats(c: Campaign) {
  const n = c.recipients.length;
  const count = (...s: string[]) => c.recipients.filter((r) => s.includes(r.status)).length;
  return {
    n,
    delivered: count("entregue", "lida", "respondeu", "descadastrou"),
    read: count("lida", "respondeu", "descadastrou"),
    replied: count("respondeu"),
    failed: count("falhou"),
    optOut: count("descadastrou"),
    pending: count("simulada", "enviada"),
  };
}
