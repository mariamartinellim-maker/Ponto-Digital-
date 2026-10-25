import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("travas de publicação na Vercel", () => {
  const original = { ...process.env };
  const loadEnv = async (vars: Record<string, string>) => {
    vi.resetModules();
    process.env = { ...original, ...vars };
    return (await import("@/lib/env")).env;
  };
  afterEach(() => {
    process.env = { ...original };
  });

  it("não sobe em modo demonstração quando publicado", async () => {
    const env = await loadEnv({ VERCEL: "1", DATA_BACKEND: "demo", APP_URL: "https://crm.vercel.app" });
    expect(() => env()).toThrow(/DATA_BACKEND=supabase/);
  });
  it("exige endereço HTTPS quando publicado", async () => {
    const env = await loadEnv({ VERCEL: "1", DATA_BACKEND: "supabase", APP_URL: "http://crm.vercel.app", SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuv" });
    expect(() => env()).toThrow(/HTTPS/);
  });
  it("recusa a chave secreta também na publicação", async () => {
    const env = await loadEnv({ VERCEL: "1", DATA_BACKEND: "supabase", APP_URL: "https://crm.vercel.app", SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_secret_abcdefghijklmnopqrstuv" });
    expect(() => env()).toThrow(/SECRETA/);
  });
  it("aceita a configuração correta, sem SESSION_SECRET", async () => {
    const env = await loadEnv({ VERCEL: "1", DATA_BACKEND: "supabase", APP_URL: "https://crm.vercel.app", SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuv", SESSION_SECRET: "" });
    expect(env().DATA_BACKEND).toBe("supabase");
  });
});
