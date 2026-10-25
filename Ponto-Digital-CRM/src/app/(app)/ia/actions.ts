"use server";

import { revalidatePath } from "next/cache";
import { authorize, clientIp } from "@/lib/auth/session";
import { KNOWLEDGE_FIELDS, type Knowledge } from "@/lib/ai/prompt";
import { suggestReply } from "@/lib/ai/suggest";
import { audit } from "@/lib/data/repo";
import { rateLimit } from "@/lib/rate-limit";
import { dbError, isSupabase, supabaseServer } from "@/lib/supabase/server";

export type KbState = { error?: string; ok?: number } | undefined;

function readKnowledge(formData: FormData): Knowledge | string {
  const kb = {} as Knowledge;
  for (const f of KNOWLEDGE_FIELDS) {
    const v = String(formData.get(f.key) ?? "").trim();
    if (v.length > f.max) return `“${f.label}” passou do limite de ${f.max} caracteres.`;
    kb[f.key] = v;
  }
  return kb;
}

export async function saveKnowledgeAction(_: KbState, formData: FormData): Promise<KbState> {
  const user = await authorize("ai:manage");
  if (!isSupabase()) return { error: "A base de conhecimento fica no Supabase. Conecte o Supabase para usar a IA." };
  const kb = readKnowledge(formData);
  if (typeof kb === "string") return { error: kb };
  const enabled = formData.get("enabled") === "on";
  if (enabled && !kb.services) return { error: "Preencha ao menos “Serviços” antes de ativar a IA." };
  const sb = await supabaseServer();
  const { data: current } = await sb.from("ai_knowledge").select("org_id").maybeSingle();
  const { error } = current
    ? await sb.from("ai_knowledge").update({ enabled, ...kb, updated_by: user.id, updated_at: new Date().toISOString() }).eq("org_id", user.orgId)
    : await sb.from("ai_knowledge").insert({ org_id: user.orgId, enabled, ...kb, updated_by: user.id });
  if (error) return { error: dbError(error) };
  await audit({ orgId: user.orgId, userId: user.id, action: enabled ? "ia.base_atualizada" : "ia.base_atualizada_desativada", entity: "ia", entityId: null, ip: await clientIp() });
  revalidatePath("/ia");
  return { ok: Date.now() };
}

export type TestState = { error?: string; reply?: string; needsHuman?: boolean; reason?: string } | undefined;

/** Testa a IA com uma pergunta de exemplo, usando o texto atual do formulário (nada é enviado a clientes). */
export async function testKnowledgeAction(_: TestState, formData: FormData): Promise<TestState> {
  const user = await authorize("ai:manage");
  if (!isSupabase()) return { error: "Disponível com o Supabase conectado." };
  if (!rateLimit(`ia-teste:${user.id}`, 5, 60_000).ok) return { error: "Aguarde um minuto entre os testes." };
  const question = String(formData.get("question") ?? "").trim().slice(0, 1000);
  if (question.length < 3) return { error: "Escreva uma pergunta de cliente para testar." };
  const kb = readKnowledge(formData);
  if (typeof kb === "string") return { error: kb };
  const r = await suggestReply({
    orgName: user.orgName,
    knowledge: kb,
    clientFirstName: "Cliente",
    messages: [{ direction: "in", origin: "cliente", body: question, createdAt: new Date().toISOString() }],
  });
  if (!r.ok) return { error: r.error };
  await audit({ orgId: user.orgId, userId: user.id, action: "ia.teste", entity: "ia", entityId: null, details: question.slice(0, 200) });
  return { reply: r.suggestion.resposta, needsHuman: r.suggestion.precisa_humano, reason: r.suggestion.motivo };
}
