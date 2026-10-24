import "server-only";
import { z } from "zod";

/**
 * Configuração validada a partir de variáveis de ambiente.
 * Nenhum segredo fica no código: tudo vem de `.env.local` (dev) ou do provedor de hospedagem.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATA_BACKEND: z.enum(["demo", "supabase"]).default("demo"),
  SESSION_SECRET: z
    .string({ error: "SESSION_SECRET não definido. Rode `npm run setup` para gerar o .env.local." })
    .min(32, "SESSION_SECRET precisa ter ao menos 32 caracteres."),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DEMO_ADMIN_EMAIL: z.string().email().default("admin@pontodigital.demo"),
  DEMO_ADMIN_PASSWORD: z.string().min(10).optional(),
  DEMO_TEAM_PASSWORD: z.string().min(10).optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // WhatsApp Cloud API (oficial da Meta). Todos opcionais até a etapa de integração.
  WHATSAPP_SEND_MODE: z.enum(["simulacao", "live"]).default("simulacao"),
  WHATSAPP_CAMPAIGNS_LIVE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  WHATSAPP_GRAPH_VERSION: z.string().default("v23.0"),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_WABA_ID: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // Variáveis vazias no .env equivalem a "não definidas".
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuração inválida do Ponto Digital CRM:\n${msg}`);
  }
  if (parsed.data.DATA_BACKEND === "supabase") {
    throw new Error(
      "DATA_BACKEND=supabase ainda não está ativo nesta versão. Use DATA_BACKEND=demo até a etapa de conexão com o Supabase.",
    );
  }
  cached = parsed.data;
  return cached;
}

/** Status das integrações, sem expor valores secretos. */
export function integrationStatus() {
  const e = env();
  return {
    backend: e.DATA_BACKEND,
    supabaseConfigured: Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    whatsapp: {
      sendMode: e.WHATSAPP_SEND_MODE,
      campaignsLive: e.WHATSAPP_CAMPAIGNS_LIVE,
      hasAccessToken: Boolean(e.WHATSAPP_ACCESS_TOKEN),
      hasPhoneNumberId: Boolean(e.WHATSAPP_PHONE_NUMBER_ID),
      hasWabaId: Boolean(e.WHATSAPP_WABA_ID),
      hasAppSecret: Boolean(e.WHATSAPP_APP_SECRET),
      hasVerifyToken: Boolean(e.WHATSAPP_VERIFY_TOKEN),
      graphVersion: e.WHATSAPP_GRAPH_VERSION,
    },
  };
}
