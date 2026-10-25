import { describe, expect, it } from "vitest";
import { isSecretKey } from "@/lib/env";

const jwt = (payload: object) =>
  ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "assinatura"].join(".");

describe("proteção contra uso da chave secreta do Supabase", () => {
  it("recusa a chave secreta (nova e legada)", () => {
    expect(isSecretKey("sb_secret_abcdefghijklmnopqrstuv")).toBe(true);
    expect(isSecretKey(jwt({ role: "service_role", iss: "supabase" }))).toBe(true);
  });
  it("aceita a chave publicável (nova e legada)", () => {
    expect(isSecretKey("sb_publishable_abcdefghijklmnopqrstuv")).toBe(false);
    expect(isSecretKey(jwt({ role: "anon", iss: "supabase" }))).toBe(false);
  });
});
