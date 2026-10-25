// Verificação de segurança de um CRM publicado (ou do servidor local de produção).
//
//   npm run verificar:publicacao -- https://SEU-ENDERECO.vercel.app
//
// Só faz leituras anônimas: não envia senhas nem altera nada. Se houver .env.local com o
// Supabase, também confere no banco real que visitantes anônimos não leem dados.
import { existsSync, readFileSync } from "node:fs";

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error("Uso: npm run verificar:publicacao -- https://SEU-ENDERECO.vercel.app");
  process.exit(1);
}
const https = base.startsWith("https://");
let falhas = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "  ✔" : "  ✘"} ${msg}`);
  if (!cond) falhas++;
};
const get = (path, opts = {}) => fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(30000), ...opts });

console.log(`\nVerificando ${base}\n`);

console.log("Páginas e acesso");
const login = await get("/login");
ok(login.status === 200 && (await login.text()).includes("Ponto Digital"), "tela de login responde");
const dash = await get("/dashboard");
ok([302, 303, 307, 308].includes(dash.status) && (dash.headers.get("location") ?? "").includes("/login"), "dashboard exige login (redireciona)");
const exp = await get("/api/clientes/00000000-0000-0000-0000-000000000000/exportar");
ok(exp.status !== 200, "exportação de dados exige login");
const hook = await get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1");
ok(hook.status === 403, "webhook do WhatsApp recusa token inválido");

console.log("Cabeçalhos de segurança");
const h = login.headers;
ok((h.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"), "Content-Security-Policy");
ok(h.get("x-frame-options") === "DENY", "X-Frame-Options: DENY");
ok(h.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
ok((h.get("x-robots-tag") ?? "").includes("noindex"), "não indexado por buscadores");
ok(!h.get("x-powered-by"), "não expõe a tecnologia do servidor");
if (https) {
  ok((h.get("strict-transport-security") ?? "").includes("max-age"), "HSTS (força HTTPS)");
  const http = await fetch(base.replace("https://", "http://") + "/login", { redirect: "manual" }).catch(() => null);
  ok(!http || [301, 302, 307, 308].includes(http.status), "HTTP redireciona para HTTPS");
} else {
  console.log("  - HSTS/HTTPS: verificados apenas no endereço publicado (https://)");
}

const envFile = new URL("../.env.local", import.meta.url);
if (existsSync(envFile)) {
  const text = readFileSync(envFile, "utf8");
  const v = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  const sbUrl = v("SUPABASE_URL");
  const key = v("SUPABASE_PUBLISHABLE_KEY");
  if (sbUrl && key) {
    console.log("Supabase (banco real, como visitante anônimo)");
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    for (const t of ["clients", "profiles", "messages", "audit_logs"]) {
      const r = await fetch(`${sbUrl}/rest/v1/${t}?select=*&limit=1`, { headers });
      const body = await r.text();
      ok(r.status >= 400 || body.trim() === "[]", `tabela ${t} não pode ser lida sem login`);
    }
    const s = await fetch(`${sbUrl}/auth/v1/settings`, { headers: { apikey: key } }).then((r) => r.json()).catch(() => ({}));
    ok(s.disable_signup === true, "cadastro público desativado (Authentication → Sign In / Providers)");
  }
}

console.log(falhas ? `\n✘ ${falhas} verificação(ões) falharam.\n` : "\n✔ Tudo certo.\n");
process.exit(falhas ? 1 : 0);
