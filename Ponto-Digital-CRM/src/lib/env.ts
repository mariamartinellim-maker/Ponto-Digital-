import "server-only";
import { z } from "zod";

/**
 * Configuração validada a partir de variáveis de ambiente.
 * Nenhum segredo fica no código: tudo vem de `.env.local` (dev) ou do provedor de hospedagem.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATA_BACKEND: z.enum(["demo", "supabase"]).default("demo"),
  // Sessão do modo demonstração (no modo Supabase quem cuida da sessão é o Supabase Auth).
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa ter ao menos 32 caracteres.").optional(),
  // Indicam que o CRM está publicado: VERCEL ("1") e RENDER ("true") são definidas pelos
  // provedores; CRM_PUBLICADO=true serve para qualquer outra hospedagem.
  VERCEL: z.string().optional(),
  RENDER: z.string().optional(),
  CRM_PUBLICADO: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DEMO_ADMIN_EMAIL: z.string().email().default("admin@pontodigital.demo"),
  DEMO_ADMIN_PASSWORD: z.string().min(10).optional(),
  DEMO_TEAM_PASSWORD: z.string().min(10).optional(),

  // Supabase: só a URL e a chave PUBLICÁVEL (publishable/anon). Ficam apenas no servidor.
  // A chave secreta (service_role) NÃO é usada nesta etapa.
  SUPABASE_URL: z.string().url("SUPABASE_URL inválida (ex.: https://abcd1234.supabase.co).").optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20, "SUPABASE_PUBLISHABLE_KEY inválida.").optional(),

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
  if (parsed.data.DATA_BACKEND === "demo" && !parsed.data.SESSION_SECRET) {
    throw new Error("SESSION_SECRET não definido. Rode `npm run setup` para gerar o .env.local.");
  }
  if (isPublished(parsed.data)) {
    // Publicado na internet: nunca em modo demonstração e sempre com endereço HTTPS.
    if (parsed.data.DATA_BACKEND !== "supabase") {
      throw new Error("Publicação bloqueada: na hospedagem defina DATA_BACKEND=supabase (o modo demonstração é só para uso local).");
    }
    if (!parsed.data.APP_URL.startsWith("https://")) {
      throw new Error("Publicação bloqueada: APP_URL precisa ser o endereço HTTPS do CRM (ex.: https://ponto-digital-crm.onrender.com).");
    }
  }
  if (parsed.data.DATA_BACKEND === "supabase") {
    if (!parsed.data.SUPABASE_URL || !parsed.data.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("DATA_BACKEND=supabase exige SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY. Rode `npm run supabase:config`.");
    }
    if (isSecretKey(parsed.data.SUPABASE_PUBLISHABLE_KEY)) {
      throw new Error(
        "SUPABASE_PUBLISHABLE_KEY contém a chave SECRETA (service_role), que ignora a segurança do banco. Use a chave publishable/anon.",
      );
    }
  }
  cached = parsed.data;
  return cached;
}

function isPublished(e: Pick<Env, "VERCEL" | "RENDER" | "CRM_PUBLICADO">) {
  return Boolean(e.VERCEL) || e.RENDER === "true" || e.CRM_PUBLICADO === "true";
}

/** Detecta a chave secreta do Supabase (nova "sb_secret_" ou JWT legado com role service_role). */
export function isSecretKey(key: string) {
  if (key.startsWith("sb_secret_")) return true;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
}

/** Status das integrações, sem expor valores secretos. */
export function integrationStatus() {
  const e = env();
  return {
    backend: e.DATA_BACKEND,
    supabaseConfigured: Boolean(e.SUPABASE_URL && e.SUPABASE_PUBLISHABLE_KEY),
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
