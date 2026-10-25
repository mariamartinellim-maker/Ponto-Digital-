// Compila o Tailwind CSS 4 para um CSS pronto e versionado (src/app/globals.css).
//
//   npm run css:build   → gera/atualiza o arquivo
//   npm run css:check   → falha se o arquivo estiver desatualizado (usado nos testes)
//
// Requer o compilador nativo do Tailwind (Oxide). Rode em Linux/macOS ou em um
// Windows sem bloqueio de Controle de Aplicativo. Quem só executa o CRM não precisa.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "src/styles/tailwind.source.css");
const output = path.join(root, "src/app/globals.css");
const check = process.argv.includes("--check");

const HEADER = `/*
 * ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE.
 * Fonte: src/styles/tailwind.source.css  ·  Gerar novamente: npm run css:build
 * CSS do Tailwind já compilado, para o CRM rodar sem o compilador nativo (Oxide).
 */
`;

const tmp = mkdtempSync(path.join(tmpdir(), "pd-css-"));
try {
  const tmpOut = path.join(tmp, "out.css");
  const cli = path.join(root, "node_modules/@tailwindcss/cli/dist/index.mjs");
  execFileSync(process.execPath, [cli, "-i", input, "-o", tmpOut, "--optimize"], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  const css = HEADER + readFileSync(tmpOut, "utf8").replace(/\r\n/g, "\n");
  let current = "";
  try {
    current = readFileSync(output, "utf8").replace(/\r\n/g, "\n");
  } catch {}
  if (check) {
    if (current !== css) {
      console.error("✘ src/app/globals.css está desatualizado. Rode: npm run css:build");
      process.exit(1);
    }
    console.log("✔ src/app/globals.css está atualizado.");
  } else {
    writeFileSync(output, css);
    console.log(`✔ CSS gerado: src/app/globals.css (${(css.length / 1024).toFixed(1)} KB)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
