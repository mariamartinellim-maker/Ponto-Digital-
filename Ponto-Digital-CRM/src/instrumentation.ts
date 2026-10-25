/** Executado uma vez quando o servidor do CRM inicia. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV === "test") return;
  // Guardian: monitoramento contínuo (verificações, eventos, backups da base demo, reconexão segura).
  const { startGuardianMonitor } = await import("./lib/guardian/guardian");
  startGuardianMonitor();
  if (process.env.WAWEB_HABILITADO !== "true") return;
  // WhatsApp Web experimental: retoma a sessão salva após reinícios e deploys, sem novo QR Code.
  const { resumeWaWebOnBoot } = await import("./lib/whatsapp-web/manager");
  void resumeWaWebOnBoot();
}
