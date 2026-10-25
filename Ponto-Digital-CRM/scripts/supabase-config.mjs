// Assistente de configuração do Supabase (funciona no Windows, macOS e Linux).
//
//   npm run supabase:config   → pede a URL e a chave publicável, testa e ativa o Supabase
//   npm run modo:demo         → volta a usar os dados demonstrativos locais (nada é apagado)
//   npm run modo:supabase     → volta a usar o Supabase (com as chaves já configuradas)
//
// Só altera o arquivo .env.local (que nunca vai para o Git) e guarda um backup antes.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

const FILE = new URL("../.env.local", import.meta.url);
const arg = process.argv[2];

if (!existsSync(FILE)) {
  console.error("✘ Arquivo .env.local não encontrado. Rode primeiro: npm run setup");
  process.exit(1);
}
let text = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");

const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const set = (k, v) => {
  const line = `${k}=${v}`;
  text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
};
const save = () => {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  copyFileSync(FILE, new URL(`../.env.local.bak-${stamp}`, import.meta.url));
  writeFileSync(FILE, text);
};

function isSecretKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
}

async function check(url, key) {
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403) throw new Error("a chave não foi aceita pelo Supabase. Confira se copiou a chave publishable/anon inteira.");
  if (!res.ok) throw new Error(`o Supabase respondeu ${res.status}. Confira a URL do projeto.`);
  return res.json();
}

if (arg === "--demo") {
  set("DATA_BACKEND", "demo");
  save();
  console.log("✔ Modo demonstração ativado (dados locais em .data/). Reinicie o CRM: npm run dev:webpack");
  process.exit(0);
}

if (arg === "--supabase") {
  if (!get("SUPABASE_URL") || !get("SUPABASE_PUBLISHABLE_KEY")) {
    console.error("✘ Supabase ainda não configurado. Rode: npm run supabase:config");
    process.exit(1);
  }
  set("DATA_BACKEND", "supabase");
  save();
  console.log("✔ Modo Supabase ativado. Reinicie o CRM: npm run dev:webpack");
  process.exit(0);
}

// Lê linha a linha (funciona digitando ou colando várias linhas de uma vez).
const rl = createInterface({ input, terminal: false });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q) => {
  output.write(q);
  const { value, done } = await lines.next();
  if (done) {
    console.error("\n✘ Entrada encerrada antes do fim.");
    process.exit(1);
  }
  return String(value);
};
console.log("\nConfiguração do Supabase — Ponto Digital CRM");
console.log("No painel do Supabase: Project Settings → API Keys (ou Data API).\n");

let url = (await ask("1) Cole a Project URL (ex.: https://abcd1234.supabase.co): ")).trim().replace(/\/+$/, "");
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
  const go = (await ask("   Essa URL não parece um projeto Supabase. Usar mesmo assim? (s/N) ")).trim().toLowerCase();
  if (go !== "s") process.exit(1);
}
const key = (await ask("2) Cole a chave PUBLISHABLE (sb_publishable_...) ou ANON (eyJ...): ")).trim();
rl.close();

if (isSecretKey(key)) {
  console.error("\n✘ Esta é a chave SECRETA (service_role). Ela NÃO deve ser usada aqui. Copie a chave publishable/anon.");
  process.exit(1);
}

try {
  const settings = await check(url, key);
  console.log("\n✔ Conexão com o Supabase confirmada.");
  if (settings.disable_signup === false) {
    console.log("⚠ O cadastro público está ATIVADO. Recomendado: Authentication → Sign In / Providers → desativar \"Allow new users to sign up\".");
  }
} catch (e) {
  console.error(`\n✘ Não foi possível conectar: ${e.message}`);
  process.exit(1);
}

set("SUPABASE_URL", url);
set("SUPABASE_PUBLISHABLE_KEY", key);
set("DATA_BACKEND", "supabase");
if (!get("APP_URL")) set("APP_URL", "http://localhost:3000");
save();
console.log("✔ .env.local atualizado (backup salvo como .env.local.bak-...).");
console.log("\nPróximo passo: reinicie o CRM com  npm run dev:webpack  e entre com seu e-mail e senha do Supabase.\n");
