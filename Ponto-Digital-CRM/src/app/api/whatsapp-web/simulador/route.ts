import { connection, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { currentSimulator } from "@/lib/whatsapp-web/simulator";

const schema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("escanear"), numero: z.string().regex(/^\d{10,15}$/) }),
  z.object({
    acao: z.literal("mensagem"),
    de: z.string().regex(/^\d{10,15}$/),
    texto: z.string().max(4096),
    nome: z.string().max(120).optional(),
    enviadaPeloCelular: z.boolean().optional(),
    grupo: z.boolean().optional(),
    midia: z
      .object({ tipo: z.enum(["image", "audio", "video", "document"]), mime: z.string().max(100), base64: z.string().max(8_000_000), arquivo: z.string().max(200).optional() })
      .optional(),
  }).refine((m) => m.texto.length > 0 || m.midia, { message: "Mensagem vazia" }),
  z.object({ acao: z.literal("queda"), codigo: z.number().int().min(400).max(599) }),
]);

/**
 * Controle do SIMULADOR do WhatsApp Web (testes locais): ler o QR Code, receber mensagens e derrubar a conexão.
 * Só existe com WAWEB_SIMULADOR=true, que o CRM recusa na hospedagem.
 */
export async function POST(req: NextRequest) {
  await connection();
  if (!env().WAWEB_SIMULADOR) return new NextResponse("Not Found", { status: 404 });
  const user = await getSessionUser();
  if (!user || !can(user.role, "settings:manage")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  const sim = currentSimulator();
  if (!sim) return NextResponse.json({ error: "Nenhuma conexão simulada ativa" }, { status: 409 });
  const p = parsed.data;
  if (p.acao === "escanear") sim.scan(p.numero);
  else if (p.acao === "mensagem") sim.message({
      from: p.de,
      text: p.texto,
      name: p.nome,
      fromMe: p.enviadaPeloCelular,
      group: p.grupo,
      media: p.midia && { type: p.midia.tipo, mime: p.midia.mime, base64: p.midia.base64, filename: p.midia.arquivo },
    });
  else sim.drop(p.codigo);
  return NextResponse.json({ ok: true });
}
