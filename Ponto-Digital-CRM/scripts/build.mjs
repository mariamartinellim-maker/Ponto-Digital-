// Compila o CRM com memória suficiente para a verificação de tipos, mesmo quando o servidor
// define um limite baixo para a EXECUÇÃO (ex.: NODE_OPTIONS=--max-old-space-size=384 no Render).
// O limite de execução continua valendo para `npm start`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const nodeOptions = `${(process.env.NODE_OPTIONS ?? "").replace(/--max-old-space-size=\d+/g, "").trim()} --max-old-space-size=4096`.trim();
const r = spawnSync(process.execPath, [next, "build", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
process.exit(r.status ?? 1);
