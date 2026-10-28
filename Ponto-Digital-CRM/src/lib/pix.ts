/**
 * Pix "copia e cola" (BR Code estático, padrão EMV do Banco Central) com chave, titular, cidade e valor.
 * Usado no cartão de cobrança Pix do WhatsApp e como texto para copiar.
 */
export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;
const plain = (s: string, max: number) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .\-@]/g, "").trim().toUpperCase().slice(0, max);

export function crc16(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Tipo e forma canônica da chave (CPF/CNPJ só números, telefone +55…, e-mail minúsculo, aleatória). */
export function normalizePixKey(raw: string): { key: string; type: PixKeyType } | null {
  const k = raw.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return { key: k.toLowerCase(), type: "EVP" };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return { key: k.toLowerCase(), type: "EMAIL" };
  if (k.startsWith("+")) {
    const d = k.replace(/\D/g, "");
    return d.length >= 12 && d.length <= 13 ? { key: `+${d}`, type: "PHONE" } : null;
  }
  const d = k.replace(/\D/g, "");
  if (d.length === 11) return { key: d, type: "CPF" };
  if (d.length === 14) return { key: d, type: "CNPJ" };
  return null;
}

export function pixCopyPaste(input: { key: string; name: string; city: string; amountCents?: number | null; txid?: string }) {
  const account = field("00", "br.gov.bcb.pix") + field("01", input.key);
  const txid = (input.txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const body = [
    field("00", "01"),
    field("26", account),
    field("52", "0000"),
    field("53", "986"),
    ...(input.amountCents ? [field("54", (input.amountCents / 100).toFixed(2))] : []),
    field("58", "BR"),
    field("59", plain(input.name, 25) || "RECEBEDOR"),
    field("60", plain(input.city, 15) || "BRASIL"),
    field("62", field("05", txid)),
    "6304",
  ].join("");
  return body + crc16(body);
}
