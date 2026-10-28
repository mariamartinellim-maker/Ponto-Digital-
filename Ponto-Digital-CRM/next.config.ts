import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content Security Policy: bloqueia scripts/conexões de terceiros. Ajustar ao incluir novos domínios.
const cspWith = (extra: { script?: string; connect?: string; frame?: string; img?: string } = {}) =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${extra.script ? " " + extra.script : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${extra.img ? " " + extra.img : ""}`,
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}${extra.connect ? " " + extra.connect : ""}`,
    `frame-src ${extra.frame ?? "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
const csp = cspWith();
// Somente na página de conexão do WhatsApp: SDK oficial da Meta (Embedded Signup / coexistência).
const cspMeta = cspWith({
  script: "https://connect.facebook.net",
  connect: "https://*.facebook.com https://graph.facebook.com",
  frame: "https://*.facebook.com",
  img: "https://*.facebook.com https://*.fbcdn.net",
});

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // CRM interno: não deve aparecer em buscadores.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Fotos de clientes para os vídeos com avatar (até 10 MB) chegam por Server Action; o padrão é 1 MB.
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  // Biblioteca do WhatsApp Web experimental: carregada pelo Node, sem empacotar (usa WebAssembly e módulos nativos do Node).
  // ffmpeg-static: binário do FFmpeg (marca d'água dos vídeos), localizado pelo caminho real em node_modules.
  serverExternalPackages: ["baileys", "ffmpeg-static"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Regra posterior com a mesma chave prevalece (documentação do next.config headers).
      { source: "/configuracoes/whatsapp", headers: [{ key: "Content-Security-Policy", value: cspMeta }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};

export default nextConfig;
