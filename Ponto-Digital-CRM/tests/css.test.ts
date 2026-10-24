import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

// O compilador nativo do Tailwind (Oxide) pode estar bloqueado (ex.: Windows com
// Controle de Aplicativo). Nesse caso, só o teste de regeneração é pulado.
let oxideAvailable = true;
try {
  createRequire(import.meta.url)("@tailwindcss/oxide");
} catch {
  oxideAvailable = false;
}

describe("CSS pré-compilado (sem Tailwind nativo em tempo de execução)", () => {
  it("o app carrega o CSS já compilado, sem PostCSS/Tailwind no build", () => {
    expect(read("src/app/layout.tsx")).toContain('import "./globals.css"');
    const css = read("src/app/globals.css");
    expect(css).toContain("ARQUIVO GERADO AUTOMATICAMENTE");
    expect(css).not.toMatch(/@import\s+["']tailwindcss["']/);
    expect(css).not.toMatch(/@theme\b|@apply\b|@source\b/);
    for (const f of ["postcss.config.mjs", "postcss.config.js", "postcss.config.cjs", "postcss.config.json", ".postcssrc"]) {
      expect(existsSync(path.join(root, f)), `${f} faria o Next carregar o Tailwind nativo`).toBe(false);
    }
  });

  it("inclui as classes e as cores da identidade visual", () => {
    const css = read("src/app/globals.css");
    for (const sel of [".size-9", ".bg-ink-950", ".bg-brand-600", ".text-coral-500", ".brand-gradient", ".shadow-card", ".lg\\:pl-64", ".lg\\:grid-cols-\\[1\\.05fr_1fr\\]"]) {
      expect(css, sel).toContain(sel + " {");
    }
    expect(css).toContain("--color-brand-600: #5a3be4");
    expect(css).toContain("--font-geist-sans");
  });

  it.skipIf(!oxideAvailable)("src/app/globals.css está atualizado em relação ao código (npm run css:check)", () => {
    expect(() =>
      execFileSync(process.execPath, [path.join(root, "scripts/build-css.mjs"), "--check"], { cwd: root, stdio: "pipe" }),
    ).not.toThrow();
  });
});
