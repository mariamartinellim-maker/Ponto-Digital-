/**
 * Normaliza telefones brasileiros para E.164 sem "+" (formato usado pelo WhatsApp: wa_id).
 * Aceita "(11) 99999-0000", "+55 11 99999 0000", "011999990000" etc.
 * Retorna null quando o número não é plausível.
 */
export function normalizePhone(raw: string, defaultCountry = "55"): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  // Remove prefixo internacional "00" e zero de operadora/tronco.
  if (digits.startsWith("00") && digits.length > 12) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length === 10 || digits.length === 11) {
    digits = defaultCountry + digits;
  }
  if (digits.startsWith("55")) {
    // Brasil: 55 + DDD (2) + 8 ou 9 dígitos
    if (digits.length !== 12 && digits.length !== 13) return null;
    const ddd = Number(digits.slice(2, 4));
    if (ddd < 11 || ddd > 99) return null;
    return digits;
  }
  // Outros países: código do país + número (E.164 tem até 15 dígitos).
  return digits.length >= 11 && digits.length <= 15 && !digits.startsWith("0") ? digits : null;
}

/**
 * Chave de deduplicação: no Brasil, celulares podem aparecer com ou sem o nono dígito
 * (ex.: 55 11 9 9999-0000 e 55 11 9999-0000). Ambos devem ser considerados o mesmo contato.
 */
export function phoneDedupKey(normalized: string): string {
  if (normalized.startsWith("55") && normalized.length === 13 && normalized[4] === "9") {
    return normalized.slice(0, 4) + normalized.slice(5);
  }
  return normalized;
}

export function formatPhone(normalized: string): string {
  if (normalized.startsWith("55") && (normalized.length === 12 || normalized.length === 13)) {
    const ddd = normalized.slice(2, 4);
    const rest = normalized.slice(4);
    const head = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
    const tail = rest.slice(head.length);
    return `+55 (${ddd}) ${head}-${tail}`;
  }
  return `+${normalized}`;
}
