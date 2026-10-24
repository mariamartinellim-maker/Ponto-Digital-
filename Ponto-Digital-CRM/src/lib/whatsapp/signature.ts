import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valida o cabeçalho `X-Hub-Signature-256` enviado pela Meta:
 * HMAC-SHA256 do corpo BRUTO da requisição usando o App Secret do aplicativo.
 */
export function verifyMetaSignature(rawBody: string | Buffer, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const [algo, received] = header.split("=");
  if (algo !== "sha256" || !received || !/^[a-f0-9]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const got = Buffer.from(received, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function signForTest(rawBody: string, appSecret: string) {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
}
