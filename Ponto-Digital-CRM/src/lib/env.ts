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

  // Supabase: URL e chave PUBLICÁVEL (publishable/anon) — usadas com a sessão de cada usuário (RLS).
  SUPABASE_URL: z.string().url("SUPABASE_URL inválida (ex.: https://abcd1234.supabase.co).").optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20, "SUPABASE_PUBLISHABLE_KEY inválida.").optional(),
  // Chave SECRETA: só no servidor (variável do Render), nunca no navegador nem no Git. Usada apenas para
  // gravar eventos do WhatsApp recebidos pelo webhook e para convidar membros da equipe.
  SUPABASE_SECRET_KEY: z.string().min(20, "SUPABASE_SECRET_KEY inválida.").optional(),

  // WhatsApp Cloud API (oficial da Meta). Todos opcionais até a conexão do número.
  WHATSAPP_SEND_MODE: z.enum(["simulacao", "live"]).default("simulacao"),
  // "teste": envio real SOMENTE para os números de WHATSAPP_NUMEROS_TESTE. "producao": clientes reais.
  WHATSAPP_AMBIENTE: z.enum(["teste", "producao"]).default("teste"),
  WHATSAPP_NUMEROS_TESTE: z.string().default(""),
  WHATSAPP_GRAPH_BASE: z.string().url().default("https://graph.facebook.com"),
  // Chave (32 bytes em base64) que criptografa o token obtido na conexão por coexistência.
  WHATSAPP_TOKEN_KEY: z.string().optional(),
  // App da Meta usado na conexão por coexistência (Embedded Signup). Não são segredos.
  META_APP_ID: z.string().regex(/^\d{5,20}$/, "META_APP_ID inválido.").optional(),
  META_ES_CONFIG_ID: z.string().regex(/^\d{5,20}$/, "META_ES_CONFIG_ID inválido.").optional(),
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

  // WhatsApp Web por QR Code — MÓDULO EXPERIMENTAL, não oficial (ver docs/WHATSAPP_WEB_EXPERIMENTAL.md).
  // Desligado por padrão; só vincula os chips de teste listados e nunca envia mensagens.
  WAWEB_HABILITADO: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Chips de teste que podem ser vinculados pelo QR Code. Qualquer outro número é desconectado na hora.
  WAWEB_NUMEROS_PERMITIDOS: z.string().default(""),
  // Contatos cujas mensagens entram no CRM (vazio = os números de WHATSAPP_NUMEROS_TESTE). Os demais são ignorados.
  WAWEB_CONTATOS_TESTE: z.string().default(""),
  // Criptografa a sessão do WhatsApp Web guardada no banco (32 bytes em base64; gere com: npm run whatsapp:chave).
  WAWEB_SESSION_KEY: z.string().optional(),
  // Simulador local para testes automatizados (nunca na hospedagem).
  WAWEB_SIMULADOR: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Inteligência artificial (Claude, da Anthropic). Sem a chave, a IA fica desligada.
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().regex(/^claude-[a-z0-9-]+$/, "AI_MODEL inválido.").default("claude-opus-5-5"),
  AI_ESFORCO: z.enum(["low", "medium", "high"]).default("low"),
  AI_LIMITE_MENSAL: z.coerce.number().int().min(0).max(100000).default(1000),

  // Vídeos com avatar (táxi/Uber). DESLIGADO por padrão. Com "true" e sem as chaves, roda o simulador
  // gratuito (sem IA: o "avatar" é a própria foto e o "vídeo" é a foto animada pelo FFmpeg).
  VIDEO_AUTOMACAO: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Chaves das APIs pagas: criadas pelo dono da conta e guardadas SÓ nas variáveis do Render.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.string().regex(/^[a-z0-9.-]+$/, "OPENAI_IMAGE_MODEL inválido.").default("gpt-image-1"),
  GOOGLE_AI_API_KEY: z.string().optional(),
  VIDEO_VEO_MODELO: z.string().regex(/^veo-[a-z0-9.-]+$/, "VIDEO_VEO_MODELO inválido.").default("veo-3.1-fast-generate-preview"),
  // Teto de gasto: quantas gerações pagas (avatar + vídeo) por mês. 0 bloqueia tudo.
  VIDEO_LIMITE_MES: z.coerce.number().int().min(0).max(1000).default(20),
  // Quantas vezes o mesmo pedido pode refazer avatar ou vídeo (ajustes do cliente).
  VIDEO_MAX_REFACOES: z.coerce.number().int().min(1).max(10).default(3),
  // Caminho do FFmpeg (opcional): sem ele, usa o binário do pacote ffmpeg-static.
  FFMPEG_PATH: z.string().optional(),
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
    if (new URL(parsed.data.WHATSAPP_GRAPH_BASE).origin !== "https://graph.facebook.com") {
      throw new Error("Publicação bloqueada: WHATSAPP_GRAPH_BASE só pode ser a API oficial (https://graph.facebook.com).");
    }
    if (parsed.data.WAWEB_SIMULADOR) {
      throw new Error("Publicação bloqueada: WAWEB_SIMULADOR é só para testes locais.");
    }
    if (parsed.data.WHATSAPP_SEND_MODE === "live" && !parsed.data.WHATSAPP_APP_SECRET) {
      throw new Error("Envio real exige WHATSAPP_APP_SECRET (validação da assinatura dos webhooks da Meta).");
    }
  }
  if (parsed.data.WAWEB_SESSION_KEY && Buffer.from(parsed.data.WAWEB_SESSION_KEY, "base64").length !== 32) {
    throw new Error("WAWEB_SESSION_KEY precisa ter 32 bytes em base64 (gere com: npm run whatsapp:chave).");
  }
  if (parsed.data.WHATSAPP_TOKEN_KEY && Buffer.from(parsed.data.WHATSAPP_TOKEN_KEY, "base64").length !== 32) {
    throw new Error("WHATSAPP_TOKEN_KEY precisa ter 32 bytes em base64 (gere com: npm run whatsapp:chave).");
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
    if (parsed.data.SUPABASE_SECRET_KEY && !isSecretKey(parsed.data.SUPABASE_SECRET_KEY)) {
      throw new Error("SUPABASE_SECRET_KEY não é a chave secreta do Supabase (sb_secret_… ou service_role).");
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

/** Números autorizados a receber envios reais no ambiente de teste (só dígitos). */
export function testNumbers() {
  return env()
    .WHATSAPP_NUMEROS_TESTE.split(/[,;\s]+/)
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length >= 10);
}

/** Status das integrações, sem expor valores secretos. */
export function integrationStatus() {
  const e = env();
  return {
    backend: e.DATA_BACKEND,
    supabaseConfigured: Boolean(e.SUPABASE_URL && e.SUPABASE_PUBLISHABLE_KEY),
    hasSupabaseSecret: Boolean(e.SUPABASE_SECRET_KEY),
    ai: { configured: Boolean(e.ANTHROPIC_API_KEY), model: e.AI_MODEL, monthlyLimit: e.AI_LIMITE_MENSAL },
    video: {
      enabled: e.VIDEO_AUTOMACAO,
      hasOpenAi: Boolean(e.OPENAI_API_KEY),
      hasGoogle: Boolean(e.GOOGLE_AI_API_KEY),
      monthlyLimit: e.VIDEO_LIMITE_MES,
    },
    whatsapp: {
      sendMode: e.WHATSAPP_SEND_MODE,
      environment: e.WHATSAPP_AMBIENTE,
      testNumbers: testNumbers().length,
      campaignsLive: e.WHATSAPP_CAMPAIGNS_LIVE,
      hasTokenKey: Boolean(e.WHATSAPP_TOKEN_KEY),
      embeddedSignup: Boolean(e.META_APP_ID && e.META_ES_CONFIG_ID),
      hasAccessToken: Boolean(e.WHATSAPP_ACCESS_TOKEN),
      hasPhoneNumberId: Boolean(e.WHATSAPP_PHONE_NUMBER_ID),
      hasWabaId: Boolean(e.WHATSAPP_WABA_ID),
      hasAppSecret: Boolean(e.WHATSAPP_APP_SECRET),
      hasVerifyToken: Boolean(e.WHATSAPP_VERIFY_TOKEN),
      graphVersion: e.WHATSAPP_GRAPH_VERSION,
    },
  };
}
