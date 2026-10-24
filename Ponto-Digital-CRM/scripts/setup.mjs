// Gera o arquivo .env.local com segredos aleatórios para desenvolvimento.
// Uso: npm run setup   (não sobrescreve um .env.local existente)
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = new URL("../.env.local", import.meta.url);
if (existsSync(file)) {
  console.log(".env.local já existe — nada foi alterado.");
  process.exit(0);
}
const rnd = (n) => randomBytes(n).toString("base64url");
const pw = () => rnd(9) + "7a"; // garante letra e número
const admin = pw();
const team = pw();
const template = readFileSync(new URL("../.env.example", import.meta.url), "utf8")
  .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${rnd(48)}`)
  .replace(/^DEMO_ADMIN_PASSWORD=.*$/m, `DEMO_ADMIN_PASSWORD=${admin}`)
  .replace(/^DEMO_TEAM_PASSWORD=.*$/m, `DEMO_TEAM_PASSWORD=${team}`)
  .replace(/^WHATSAPP_VERIFY_TOKEN=.*$/m, `WHATSAPP_VERIFY_TOKEN=${rnd(24)}`);
writeFileSync(file, template, { mode: 0o600 });
console.log("✔ .env.local criado com segredos aleatórios.\n");
console.log("  Acesso de demonstração (guarde em local seguro):");
console.log("  Administrador: admin@pontodigital.demo  /  senha: " + admin);
console.log("  Equipe (lucas@, ana@, pedro@pontodigital.demo)  /  senha: " + team + "\n");
