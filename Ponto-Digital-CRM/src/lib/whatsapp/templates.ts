import "server-only";
import { supabaseAdmin } from "../supabase/admin";
import { waCredentials } from "./client";
import { graph } from "./graph";

/** Exemplos exigidos pela Meta para modelos com variáveis ({{1}}, {{2}}…). */
export function exampleValues(body: string) {
  const n = new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
  return Array.from({ length: n }, (_, i) => (i === 0 ? "Maria" : `exemplo ${i + 1}`));
}

/** Envia um modelo para análise da Meta (não envia mensagem a ninguém). */
export async function submitTemplate(orgId: string, tpl: { name: string; language: string; category: string; body: string }) {
  const creds = await waCredentials(orgId);
  if (!creds?.wabaId) throw new Error("Conecte o WhatsApp (ID da conta WABA) antes de enviar modelos para análise.");
  const examples = exampleValues(tpl.body);
  const r = await graph<{ id: string; status: string }>(`${creds.wabaId}/message_templates`, creds.token, {
    json: {
      name: tpl.name,
      language: tpl.language,
      category: tpl.category,
      components: [{ type: "BODY", text: tpl.body, ...(examples.length ? { example: { body_text: [examples] } } : {}) }],
    },
  });
  return { id: r.id, status: r.status };
}

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: { type: string; text?: string }[];
}

/** Traz da Meta o status de todos os modelos (e os criados direto no WhatsApp Manager). */
export async function syncTemplates(orgId: string) {
  const creds = await waCredentials(orgId);
  if (!creds?.wabaId) throw new Error("Conecte o WhatsApp (ID da conta WABA) antes de sincronizar.");
  const list: MetaTemplate[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = await graph<{ data: MetaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${creds.wabaId}/message_templates`, creds.token, {
      query: { fields: "id,name,language,status,category,components", limit: "100", ...(after ? { after } : {}) },
    });
    list.push(...r.data);
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  const db = supabaseAdmin();
  const { data: existing } = await db.from("message_templates").select("id,name,language").eq("org_id", orgId);
  const byKey = new Map((existing ?? []).map((t) => [`${t.name}|${t.language}`, String(t.id)]));
  let updated = 0;
  let created = 0;
  for (const t of list) {
    const status = t.status === "APPROVED" ? "APPROVED" : ["REJECTED", "DISABLED", "PAUSED"].includes(t.status) ? "REJECTED" : "PENDING";
    const id = byKey.get(`${t.name}|${t.language}`);
    if (id) {
      await db.from("message_templates").update({ status, meta_template_id: t.id }).eq("id", id);
      updated++;
    } else if (/^[a-z0-9_]{3,60}$/.test(t.name) && ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(t.category)) {
      const body = (t.components?.find((c) => c.type === "BODY")?.text ?? "").slice(0, 1024);
      const { error } = await db
        .from("message_templates")
        .insert({ org_id: orgId, name: t.name, language: t.language, category: t.category, body: body || "(modelo sem texto)", status, meta_template_id: t.id });
      if (!error) created++;
    }
  }
  return { updated, created, total: list.length };
}
