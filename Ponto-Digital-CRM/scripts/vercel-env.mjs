// Gera o bloco de variáveis para colar na Vercel (Settings → Environment Variables).
//
//   npm run vercel:env -- https://SEU-ENDERECO.vercel.app
//
// Usa o seu .env.local apenas para copiar a URL e a chave PUBLICÁVEL do Supabase.
// Senhas locais, SESSION_SECRET e dados de demonstração NÃO são incluídos.
import { existsSync, readFileSync } from "node:fs";

const FILE = new URL("../.env.local", import.meta.url);
if (!existsSync(FILE)) {
  console.error("✘ .env.local não encontrado. Configure o Supabase antes: npm run supabase:config");
  process.exit(1);
}
const text = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const url = get("SUPABASE_URL");
const key = get("SUPABASE_PUBLISHABLE_KEY");
if (!url || !key) {
  console.error("✘ Supabase não configurado neste computador. Rode: npm run supabase:config");
  process.exit(1);
}
if (key.startsWith("sb_secret_")) {
  console.error("✘ A chave no .env.local é a SECRETA. Rode npm run supabase:config e use a publishable.");
  process.exit(1);
}
let appUrl = (process.argv[2] ?? "").trim().replace(/\/+$/, "");
if (appUrl && !/^https:\/\/[^/]+$/.test(appUrl)) {
  console.error("✘ Informe o endereço completo com https://, ex.: npm run vercel:env -- https://ponto-crm.vercel.app");
  process.exit(1);
}
if (!appUrl) appUrl = "https://SEU-ENDERECO.vercel.app";

console.log("\nCopie as linhas abaixo e cole na Vercel (Settings → Environment Variables → cole no campo \"Key\"):\n");
console.log("-----8<-----");
console.log(`DATA_BACKEND=supabase
SUPABASE_URL=${url}
SUPABASE_PUBLISHABLE_KEY=${key}
APP_URL=${appUrl}
WHATSAPP_SEND_MODE=simulacao
WHATSAPP_CAMPAIGNS_LIVE=false`);
console.log("-----8<-----\n");
if (appUrl.includes("SEU-ENDERECO")) {
  console.log("⚠ Troque APP_URL pelo endereço real assim que a Vercel mostrar (ex.: https://ponto-crm.vercel.app).\n");
}
