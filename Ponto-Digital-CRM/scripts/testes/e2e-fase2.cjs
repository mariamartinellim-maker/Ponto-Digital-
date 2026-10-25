// Teste ponta a ponta da Fase 2 (WhatsApp oficial em coexistência, equipe, IA) no modo Supabase.
// Exige o ambiente LOCAL de testes: PostgreSQL com as migrações, PostgREST, simulador do Supabase Auth,
// simuladores da Meta (scripts/testes/mock-meta.mjs) e da Anthropic (scripts/testes/mock-anthropic.mjs)
// e o CRM rodando com WHATSAPP_GRAPH_BASE/ANTHROPIC_BASE_URL apontando para os simuladores.
// NUNCA aponte este teste para o WhatsApp, a IA ou o banco reais.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { createHmac } = require("crypto");
const fs = require("fs");

const BASE = process.env.BASE || "http://localhost:3000";
const META = "http://127.0.0.1:4010";
const AI = "http://127.0.0.1:4020";
const APP_SECRET = "segredo-app-teste";
const DB = process.env.DB || "pdcrm_sb";
const TEST_NUMBER = "5511977770001"; // único número liberado no ambiente de teste
const sql = (q) => execSync(`su postgres -c "psql -d ${DB} -tAc \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
let fails = 0;
const ok = (c, m) => {
  console.log((c ? "  ✔ " : "  ✘ ") + m);
  if (!c) fails++;
};
const metaLog = async () => (await fetch(META + "/__log")).json();
const aiLog = async () => (await fetch(AI + "/__log")).json();
let seq = 0;
async function webhook(field, value, { secret = APP_SECRET, phoneId = "PN123" } = {}) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA123", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { display_phone_number: "5511900000000", phone_number_id: phoneId }, ...value } }] }],
  });
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const r = await fetch(BASE + "/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const inbound = (from, name, text, extra = {}) =>
  webhook("messages", {
    contacts: [{ wa_id: from, profile: { name } }],
    messages: [{ from, id: `wamid.IN.${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text }, ...extra }],
  });
async function login(p, email, pw) {
  await p.goto(BASE + "/login");
  await p.fill("#email", email);
  await p.fill("#password", pw);
  await p.click("button[type=submit]");
  await p.waitForURL("**/dashboard");
}

(async () => {
  const b = await chromium.launch();
  const admin = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  admin.on("pageerror", (e) => errors.push(e.message));
  await fetch(META + "/__reset", { method: "POST" });

  console.log("1. Configuração do WhatsApp (administradora)");
  await login(admin, "maria@pontodigital.test", "Maria-Teste-2026");
  const before = await webhook("messages", { messages: [{ from: "5511900000001", id: "wamid.ANTES", timestamp: "1", type: "text", text: { body: "oi" } }] });
  ok(before.status === 200 && before.json?.ignorados_numero_nao_vinculado === 1 && sql("select count(*) from public.messages where wa_message_id='wamid.ANTES'") === "0",
    "antes de vincular, eventos do número são ignorados (nada gravado no escuro)");
  await admin.goto(BASE + "/configuracoes/whatsapp");
  await admin.click('button:has-text("Vincular número do servidor")');
  await admin.waitForSelector("text=Confirmada pela Meta — o app continua no celular");
  ok(sql("select wa_phone_number_id from public.organizations") === "PN123", "número vinculado à organização após conferência (somente leitura) na Meta");
  ok((await metaLog()).every((c) => c.method === "GET"), "vincular não altera nada na Meta (apenas consulta)");
  ok(!(await metaLog()).some((c) => c.path.includes("/register")), "nenhuma chamada de registro/migração do número");

  console.log("2. Equipe: rodízio e convite");
  await admin.goto(BASE + "/equipe");
  await admin.click('li:has-text("Ana Atendente") button:has-text("Incluir no rodízio")');
  await admin.waitForSelector('li:has-text("Ana Atendente") >> text=No rodízio');
  await admin.check('input[name=mode][value=rodizio]');
  await admin.click('form:has(input[name=mode]) button:has-text("Salvar")');
  await admin.waitForTimeout(800);
  ok(sql("select wa_distribution from public.organizations") === "rodizio", "distribuição por rodízio ativada");
  await admin.fill("#name", "Bruno Novo");
  await admin.fill("#email", "bruno@pontodigital.test");
  await admin.click('button:has-text("Enviar convite")');
  await admin.waitForSelector("text=Convite enviado para bruno@pontodigital.test");
  ok(sql("select role from public.profiles where email='bruno@pontodigital.test'") === "atendente", "convite cria o perfil (a pessoa define a própria senha)");
  ok(fs.readFileSync("/tmp/sb/emails.log", "utf8").includes("CONVITE bruno@pontodigital.test"), "e-mail de convite enviado pelo Supabase Auth");

  console.log("3. Mensagens reais chegando pelo webhook");
  const bad = await webhook("messages", { messages: [] }, { secret: "errado" });
  ok(bad.status === 401, "evento com assinatura inválida é recusado");
  const r1 = await inbound(TEST_NUMBER, "Teste Equipe", "Olá, quero um orçamento de site");
  ok(r1.status === 200 && r1.json?.inserted === 1 && r1.json?.newClients === 1, "mensagem de cliente novo gravada");
  const dup = await webhook("messages", {
    contacts: [{ wa_id: TEST_NUMBER, profile: { name: "Teste Equipe" } }],
    messages: [{ from: TEST_NUMBER, id: `wamid.IN.${seq}`, timestamp: "1", type: "text", text: { body: "Olá, quero um orçamento de site" } }],
  });
  ok(dup.json?.duplicate === 1 && sql(`select count(*) from public.messages where wa_message_id='wamid.IN.${seq}'`) === "1", "reenvio da Meta não duplica");
  ok(sql(`select p.name from public.conversations c join public.clients k on k.id=c.client_id join public.profiles p on p.id=c.assignee_id where k.phone='${TEST_NUMBER}'`) === "Ana Atendente",
    "conversa nova distribuída pelo rodízio");
  ok(sql(`select d.stage from public.deals d join public.clients k on k.id=d.client_id where k.phone='${TEST_NUMBER}'`) === "novo_lead", "cliente novo entra no funil como Novo Lead");
  await inbound(TEST_NUMBER, "Teste Equipe", "", { type: "image", image: { id: "MEDIA777", mime_type: "image/png", caption: "Minha logo" }, text: undefined });
  await webhook("smb_message_echoes", { message_echoes: [{ from: "5511900000000", to: TEST_NUMBER, id: "wamid.ECO1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Respondi pelo celular!" } }] });
  await webhook("smb_app_state_sync", { state_sync: [{ type: "contact", contact: { full_name: "Paula do App", phone_number: "5521966665555" }, action: "add" }] });
  await webhook("history", { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [{ id: "5521966665555", messages: [{ from: "5521966665555", id: "wamid.HIST1", timestamp: "1750000000", type: "text", text: { body: "Mensagem antiga do app" } }] }] }] });
  ok(sql("select name from public.clients where phone='5521966665555'") === "Paula do App", "histórico do app importado com o nome salvo nos contatos");
  ok(sql("select unread from public.conversations c join public.clients k on k.id=c.client_id where k.phone='5521966665555'") === "0", "histórico não gera mensagens não lidas");
  const other = await webhook("messages", { messages: [{ from: "5511900000002", id: "wamid.OUTRO", timestamp: "1", type: "text", text: { body: "x" } }] }, { phoneId: "PN999" });
  ok(other.json?.ignorados_numero_nao_vinculado === 1, "evento de outro número é ignorado");

  console.log("4. Atendimento pela atendente (envio real controlado)");
  const ana = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  ana.on("pageerror", (e) => errors.push(e.message));
  await login(ana, "ana@pontodigital.test", "Ana-Teste-2026");
  await ana.goto(BASE + "/inbox");
  await ana.click('a:has-text("Teste Equipe")');
  await ana.waitForSelector("text=Respondi pelo celular!");
  ok(await ana.isVisible("text=Enviada pelo app WhatsApp Business"), "mensagem enviada pelo celular aparece no CRM (coexistência)");
  const img = ana.locator('img[alt="Minha logo"]');
  await img.waitFor();
  const imgOk = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
  ok(imgOk, "imagem recebida exibida (baixada da Meta sob demanda, com login)");
  const mediaAnon = await fetch(BASE + "/api/whatsapp/midia/" + sql("select id from public.messages where media->>'id'='MEDIA777'"), { redirect: "manual" });
  ok(mediaAnon.status !== 200, "mídia não pode ser aberta sem login");

  await fetch(META + "/__reset", { method: "POST" });
  await ana.fill('textarea[name="body"]', "Oi! Já te mando a proposta.");
  await ana.click('button[aria-label="Enviar"]');
  await ana.waitForSelector("li:has-text('Oi! Já te mando a proposta.')");
  const sent = (await metaLog()).find((c) => c.path.endsWith("/PN123/messages"));
  ok(sent?.body?.to === TEST_NUMBER && sent.body.text.body === "Oi! Já te mando a proposta.", "resposta enviada pela Cloud API oficial para o número de teste");
  const wamid = sql("select wa_message_id from public.messages where body='Oi! Já te mando a proposta.'");
  ok(wamid.startsWith("wamid.MOCK."), "mensagem registrada com o ID oficial da Meta");
  await webhook("messages", { statuses: [{ id: wamid, status: "delivered", timestamp: "2", recipient_id: TEST_NUMBER }, { id: wamid, status: "read", timestamp: "3", recipient_id: TEST_NUMBER }] });
  ok(sql(`select status from public.messages where wa_message_id='${wamid}'`) === "lida", "status de entrega/leitura atualizado pelo webhook");

  console.log("5. Sugestão da IA (nível 1, humano aprova)");
  await ana.reload();
  await ana.waitForSelector('button[aria-label="Sugerir resposta com IA"]').catch(() => {});
  ok(!(await ana.isVisible('button[aria-label="Sugerir resposta com IA"]')), "sem a base de conhecimento ativada, o botão da IA não aparece");
  await admin.goto(BASE + "/ia");
  await admin.fill("#kb-services", "Sites, landing pages e tráfego pago.");
  await admin.fill("#kb-prices", "Site a partir de R$ 2.500. Desconto só com aprovação da direção.");
  await admin.fill("#kb-tone", "Cordial, sem gírias, mensagens curtas.");
  await admin.fill("#question", "Quanto custa um site?");
  await admin.click('button:has-text("Ver sugestão da IA")');
  await admin.waitForSelector("text=Fazemos sites a partir de R$ 2.500");
  ok(true, "teste da base de conhecimento antes de ativar");
  await admin.check('input[name="enabled"]');
  await admin.click('button:has-text("Salvar base de conhecimento")');
  await admin.waitForSelector("text=Base de conhecimento salva.");
  const atendenteIa = await (await b.newContext()).newPage();
  await login(atendenteIa, "ana@pontodigital.test", "Ana-Teste-2026");
  await atendenteIa.goto(BASE + "/ia");
  await atendenteIa.waitForURL("**/sem-permissao");
  ok(true, "atendente não edita a base de conhecimento");
  await ana.reload();
  await ana.click('button[aria-label="Sugerir resposta com IA"]');
  await ana.waitForSelector("text=Sugestão da IA — revise antes de enviar.");
  ok((await ana.inputValue('textarea[name="body"]')).includes("R$ 2.500"), "sugestão vai para a caixa de texto, editável");
  ok((await metaLog()).filter((c) => c.path.endsWith("/messages")).length === 1, "pedir sugestão não envia nada ao cliente");
  const req = (await aiLog()).at(-1);
  ok(req.body.system?.[0]?.cache_control?.type === "ephemeral" && req.body.system[0].text.includes("R$ 2.500"), "base de conhecimento enviada com cache de prompt");
  ok(!JSON.stringify(req.body.messages).includes(TEST_NUMBER), "telefone do cliente não é enviado à IA");
  ok(req.body.fallbacks === "default" && String(req.headers.beta).includes("server-side-fallback"), "modelo reserva em caso de recusa ativado");
  await ana.fill('textarea[name="body"]', (await ana.inputValue('textarea[name="body"]')) + " Posso te ligar?");
  await ana.click('button[aria-label="Enviar"]');
  await ana.waitForSelector("text=sugerida pela IA");
  ok(sql("select ai_assisted from public.messages where body like '%Posso te ligar?'") === "t" && sql("select status from public.ai_suggestions order by created_at desc limit 1") === "usada",
    "mensagem enviada após revisão humana fica marcada como sugerida pela IA");
  await inbound(TEST_NUMBER, "Teste Equipe", "Consegue um desconto?");
  await ana.reload();
  await ana.click('button[aria-label="Sugerir resposta com IA"]');
  await ana.waitForSelector("text=Atenção: decisão humana necessária.");
  ok(true, "pedido de desconto: IA avisa que precisa de decisão humana");

  console.log("6. Travas do ambiente de teste e arquivos");
  const cafe = sql("select id from public.conversations where id='cc000000-0000-0000-0000-000000000001'");
  sql(`update public.conversations set assignee_id='22222222-2222-2222-2222-222222222222' where id='${cafe}'`);
  await ana.goto(BASE + "/inbox/" + cafe);
  await webhook("messages", { messages: [{ from: "5511900001000", id: "wamid.CAFE2", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Ainda tem vaga?" } }] });
  await ana.reload();
  const callsBefore = (await metaLog()).length;
  await ana.fill('textarea[name="body"]', "Temos sim!");
  await ana.click('button[aria-label="Enviar"]');
  await ana.waitForSelector("text=Ambiente de teste: o envio real só é permitido para os números de teste");
  ok((await metaLog()).length === callsBefore && sql("select count(*) from public.messages where body='Temos sim!'") === "0", "cliente real (fora da lista de teste) não recebe nada no ambiente de teste");
  const conv = sql(`select c.id from public.conversations c join public.clients k on k.id=c.client_id where k.phone='${TEST_NUMBER}'`);
  await ana.goto(BASE + "/inbox/" + conv);
  fs.writeFileSync("/tmp/sb/logo-teste.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
  await ana.click('button[aria-label="Anexar arquivo"]');
  await ana.setInputFiles('input[aria-label="Arquivo"]', "/tmp/sb/logo-teste.png");
  await ana.click('button:has-text("Enviar arquivo")');
  await ana.waitForSelector('img[alt="Imagem recebida"], li:has-text("logo-teste.png")').catch(() => {});
  await ana.waitForTimeout(800);
  const calls = await metaLog();
  ok(calls.some((c) => c.path.endsWith("/PN123/media")) && calls.some((c) => c.body?.type === "image" && c.body.image?.id?.startsWith("MEDIA.UP.")), "imagem enviada: upload oficial + mensagem de imagem");
  const anon = await fetch(BASE + "/api/whatsapp/enviar-midia", { method: "POST", body: new FormData(), redirect: "manual" });
  ok(anon.status >= 300 && anon.status < 400, "envio de arquivo exige login");
  const csrf = await ana.context().request.post(BASE + "/api/whatsapp/enviar-midia", {
    headers: { origin: "https://site-malicioso.example" },
    multipart: { conversationId: conv, file: { name: "x.png", mimeType: "image/png", buffer: fs.readFileSync("/tmp/sb/logo-teste.png") } },
  });
  ok(csrf.status() === 403, "envio de arquivo a partir de outro site é recusado mesmo com login (CSRF)");

  console.log("7. Agenda, respostas rápidas, modelos e campanha (gestor/admin)");
  await admin.goto(BASE + "/agenda");
  await admin.fill("#title", "Retornar orçamento do site");
  await admin.fill("#dueAt", "2030-01-15T10:30");
  await admin.click('button:has-text("Agendar")');
  await admin.waitForSelector("li:has-text('Retornar orçamento do site')");
  ok(sql("select count(*) from public.tasks where title='Retornar orçamento do site'") === "1", "tarefa criada na agenda");
  await admin.goto(BASE + "/modelos");
  await admin.fill("#shortcut", "site");
  await admin.fill("#qr-title", "Preço de site");
  await admin.fill("#qr-body", "Nossos sites começam em R$ 2.500.");
  await admin.click('button:has-text("Adicionar resposta")');
  await admin.waitForSelector("text=/site");
  ok(sql("select count(*) from public.quick_replies where shortcut='site'") === "1", "resposta rápida criada");
  await admin.fill("#tpl-name", "oferta_site");
  await admin.selectOption("#category", "MARKETING");
  await admin.fill("#tpl-body", "Olá {{1}}! Site profissional com condição especial. Responda SAIR para não receber mais mensagens.");
  await admin.click('button:has-text("Salvar modelo")');
  await admin.waitForSelector("li:has-text('oferta_site') >> text=Em análise");
  await admin.click('li:has-text("oferta_site") button:has-text("Enviar para análise da Meta")');
  await admin.waitForSelector("li:has-text('oferta_site') >> text=Enviado à Meta · aguardando análise");
  const tplCall = (await metaLog()).find((c) => c.path.endsWith("/WABA123/message_templates") && c.method === "POST");
  ok(tplCall?.body?.name === "oferta_site" && tplCall.body.components[0].example.body_text[0][0] === "Maria", "modelo enviado para análise da Meta com exemplos");
  await webhook("message_template_status_update", { event: "APPROVED", message_template_id: "TPL1", message_template_name: "oferta_site", message_template_language: "pt_BR" });
  ok(sql("select status from public.message_templates where name='oferta_site'") === "APPROVED", "aprovação da Meta chega pelo webhook");
  await admin.goto(BASE + "/campanhas/nova");
  await admin.fill("#name", "Campanha teste sites");
  await admin.selectOption('select[name="templateId"]', { label: /oferta_site/ }).catch(async () => {
    const v = await admin.locator('select[name="templateId"] option', { hasText: "oferta_site" }).getAttribute("value");
    await admin.selectOption('select[name="templateId"]', v);
  });
  await admin.click('button:has-text("Salvar como rascunho")');
  await admin.waitForURL(/\/campanhas\/[0-9a-f-]{36}$/);
  await admin.waitForSelector("text=Execução em modo simulação");
  const metaBefore = (await metaLog()).length;
  await admin.check('input[name="confirm"]');
  await admin.click('button:has-text("Executar simulação")');
  await admin.waitForSelector("text=Executada (simulação)");
  const campId = admin.url().split("/").pop();
  ok(sql(`select count(*) from public.campaign_recipients where campaign_id='${campId}'`) === "1", "campanha: só o cliente com consentimento entra no público");
  ok((await metaLog()).length === metaBefore, "campanha em simulação não envia nada à Meta (WHATSAPP_CAMPAIGNS_LIVE=false)");

  console.log("8. LGPD: descadastro e anonimização");
  await inbound(TEST_NUMBER, "Teste Equipe", "PARAR");
  ok(sql(`select consent_status from public.clients where phone='${TEST_NUMBER}'`) === "opt_out", "PARAR descadastra o contato");
  const paula = sql("select id from public.clients where phone='5521966665555'");
  await admin.goto(BASE + "/clientes/" + paula);
  await admin.fill('input[name="confirm"]', "ANONIMIZAR");
  await admin.click('button:has-text("Anonimizar")');
  await admin.waitForURL("**/clientes");
  ok(sql(`select name from public.clients where id='${paula}'`) === "Titular anonimizado" && sql(`select count(*) from public.conversations where client_id='${paula}'`) === "0",
    "anonimização remove dados pessoais e conversas");

  console.log("9. Auditoria");
  await admin.goto(BASE + "/auditoria");
  await admin.waitForSelector("tbody tr");
  for (const a of ["whatsapp.numero_vinculado", "usuario.convidado", "equipe.distribuicao", "whatsapp.mensagem_enviada", "ia.sugestao", "modelo.enviado_meta", "lgpd.anonimizacao"]) {
    ok((await admin.locator(`code:text-is("${a}")`).count()) > 0, `auditoria registra ${a}`);
  }

  console.log("\nErros de página:", errors.length ? errors : "nenhum");
  console.log(fails ? `${fails} FALHA(S)` : "TODOS OS CENÁRIOS DA FASE 2 PASSARAM");
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
