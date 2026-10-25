import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Criptografia do token do WhatsApp guardado no banco (AES-256-GCM).
 * A chave existe só nas variáveis do servidor: quem tiver acesso ao banco não lê o token.
 * Formato: v1.<iv>.<tag>.<conteúdo> (base64url).
 */
export function encryptSecret(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("Chave de criptografia inválida.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(box: string, keyB64: string): string {
  const [v, iv, tag, data] = box.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Formato de segredo inválido.");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
