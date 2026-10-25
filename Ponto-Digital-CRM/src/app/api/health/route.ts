import { connection, NextResponse } from "next/server";
import { overallStatus, runChecks } from "@/lib/guardian/guardian";

/**
 * Verificação de saúde para o Render e monitores externos. Público, mas só devolve o estado
 * geral e o nome de cada verificação (sem detalhes de configuração).
 */
export async function GET() {
  await connection();
  const checks = await runChecks().catch(() => [{ id: "guardian", label: "Guardian", status: "erro" as const, detail: "" }]);
  const status = overallStatus(checks);
  return NextResponse.json(
    { status, checks: Object.fromEntries(checks.map((c) => [c.id, c.status])), at: new Date().toISOString() },
    { status: status === "erro" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
