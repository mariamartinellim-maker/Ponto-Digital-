import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // A chave SECRETA do Supabase ignora o RLS: só estes módulos do servidor podem usá-la.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/supabase/admin.ts",
      "src/lib/whatsapp/client.ts",
      "src/lib/whatsapp/ingest.ts",
      "src/lib/whatsapp/templates.ts",
      "src/lib/whatsapp-web/auth-state.ts",
      "src/lib/whatsapp-web/manager.ts",
      "src/lib/data/collections.ts",
      "src/lib/media/storage.ts",
      "src/lib/guardian/guardian.ts",
      // Robô dos vídeos: envia e acompanha conversas sem usuário logado.
      "src/lib/video/outbox.ts",
      "src/lib/video/autopilot.ts",
      "src/app/api/webhooks/whatsapp/route.ts",
      "src/app/(app)/configuracoes/whatsapp/**",
      "src/app/(app)/equipe/actions.ts",
      "src/app/(app)/modelos/actions.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/supabase/admin", "@/lib/supabase/admin"], message: "Uso da chave secreta restrito (ver src/lib/supabase/admin.ts)." }] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // scripts utilitários em Node puro (fora do app)
    "scripts/**",
  ]),
]);

export default eslintConfig;
