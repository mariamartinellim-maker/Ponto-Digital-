import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Hash de senha com scrypt + salt aleatório. Formato: scrypt$N$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length, {
    ...PARAMS,
    N: Number(n),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const PASSWORD_RULES = "Mínimo de 10 caracteres, com letras e números.";
export function isStrongPassword(pw: string) {
  return pw.length >= 10 && pw.length <= 128 && /[a-zA-Z]/.test(pw) && /\d/.test(pw);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
