"use server";

import { authorize } from "@/lib/auth/session";
import { loadKnowledge, recordSuggestionDemo, setSuggestionStatusDemo, usageThisMonth } from "@/lib/ai/knowledge";
import { suggestReply } from "@/lib/ai/suggest";
import { firstName, KNOWLEDGE_FIELDS, type Knowledge, type Suggestion } from "@/lib/ai/prompt";
import { audit } from "@/lib/data/repo";
import { getDb } from "@/lib/data/store";
import { env } from "@/lib/env";
import { canSeeConversation } from "@/lib/inbox";
import { rateLimit } from "@/lib/rate-limit";
import { loadConversation } from "@/lib/supabase/ops";
import { isSupabase, supabaseServer } from "@/lib/supabase/server";

export type AiSuggestion =
  | { ok: true; id: string; text: string; needsHuman: boolean; reason: string; intent: Suggestion["intencao"]; stage: Suggestion["etapa_sugerida"] }
  | { ok: false; error: string };

/**
 * Nível 1 da IA: sugere uma resposta. NADA é enviado ao cliente aqui — o texto vai para a caixa de
 * mensagem, o atendente revisa, edita e decide se envia.
 */
export async function suggestReplyAction(conversationId: string): Promise<AiSuggestion> {
  const user = await authorize("ai:use");
  if (!env().ANTHROPIC_API_KEY) return { ok: false, error: "IA não configurada no servidor (ANTHROPIC_API_KEY)." };
  if (!rateLimit(`ia:${user.id}`, 10, 60_000).ok) return { ok: false, error: "Muitas sugestões seguidas. Aguarde um minuto." };

  const kb = await loadKnowledge(user.orgId);
  if (!kb?.enabled) return { ok: false, error: "A IA está desativada. Um gestor pode ativá-la em “Assistente de IA”." };
  if ((await usageThisMonth(user.orgId)).count >= env().AI_LIMITE_MENSAL) {
    return { ok: false, error: `Limite mensal de ${env().AI_LIMITE_MENSAL} sugestões atingido. Fale com o administrador.` };
  }

  // Conversa e últimas 20 mensagens (Supabase com RLS, ou base local de demonstração/testes).
  let clientName = "";
  let messages: { direction: "in" | "out"; origin: string; body: string; createdAt: string }[];
  if (isSupabase()) {
    const sb = await supabaseServer();
    const target = await loadConversation(conversationId);
    if (!target || !canSeeConversation(user, target.conv)) return { ok: false, error: "Conversa não encontrada." };
    const [{ data: client }, { data: rows }] = await Promise.all([
      sb.from("clients").select("name").eq("id", target.client.id).maybeSingle(),
      sb.from("messages").select("direction,origin,body,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(20),
    ]);
    clientName = String(client?.name ?? "");
    messages = (rows ?? []).map((r) => ({ direction: r.direction as "in" | "out", origin: String(r.origin), body: String(r.body), createdAt: String(r.created_at) })).reverse();
  } else {
    const db = await getDb();
    const conv = db.conversations.find((c) => c.id === conversationId && c.orgId === user.orgId);
    if (!conv || !canSeeConversation(user, conv)) return { ok: false, error: "Conversa não encontrada." };
    clientName = db.clients.find((c) => c.id === conv.clientId)?.name ?? "";
    messages = db.messages
      .filter((m) => m.conversationId === conversationId)
      .slice(-20)
      .map((m) => ({ direction: m.direction, origin: m.origin, body: m.body, createdAt: m.createdAt }));
  }
  if (!messages.some((m) => m.direction === "in")) return { ok: false, error: "O cliente ainda não enviou mensagens nesta conversa." };

  const knowledge = Object.fromEntries(KNOWLEDGE_FIELDS.map((f) => [f.key, kb[f.key]])) as unknown as Knowledge;
  const r = await suggestReply({ orgName: user.orgName, knowledge, clientFirstName: firstName(clientName), messages });
  if (!r.ok) return r;

  let id: string;
  if (isSupabase()) {
    const { data: saved, error } = await (await supabaseServer())
      .from("ai_suggestions")
      .insert({
        org_id: user.orgId,
        conversation_id: conversationId,
        created_by: user.id,
        model: r.model.slice(0, 60),
        suggestion: r.suggestion.resposta,
        needs_human: r.suggestion.precisa_humano,
        reason: r.suggestion.motivo,
        input_tokens: r.usage.input,
        output_tokens: r.usage.output,
        cache_read_tokens: r.usage.cacheRead,
      })
      .select("id")
      .single();
    if (error || !saved) return { ok: false, error: "Não foi possível registrar a sugestão." };
    id = String(saved.id);
  } else {
    id = await recordSuggestionDemo({
      orgId: user.orgId,
      conversationId,
      createdBy: user.id,
      model: r.model.slice(0, 60),
      suggestion: r.suggestion.resposta,
      needsHuman: r.suggestion.precisa_humano,
      reason: r.suggestion.motivo,
      inputTokens: r.usage.input,
      outputTokens: r.usage.output,
      cacheReadTokens: r.usage.cacheRead,
    });
  }
  await audit({ orgId: user.orgId, userId: user.id, action: "ia.sugestao", entity: "conversa", entityId: conversationId, details: r.suggestion.precisa_humano ? `precisa de humano: ${r.suggestion.motivo}` : "sugestão gerada" });

  return {
    ok: true,
    id,
    text: r.suggestion.resposta,
    needsHuman: r.suggestion.precisa_humano,
    reason: r.suggestion.motivo,
    intent: r.suggestion.intencao,
    stage: r.suggestion.etapa_sugerida,
  };
}

export async function discardSuggestionAction(id: string) {
  const user = await authorize("ai:use");
  if (!isSupabase()) return setSuggestionStatusDemo(user.orgId, id, "descartada");
  const sb = await supabaseServer();
  await sb.from("ai_suggestions").update({ status: "descartada" }).eq("id", id).eq("status", "sugerida");
}
