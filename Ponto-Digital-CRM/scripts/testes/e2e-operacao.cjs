// Teste integrado ponta a ponta: atendimento → venda → comprovante → confirmação financeira → produção.
// Tudo simulado: WhatsApp Web pelo SIMULADOR, IA pelo simulador da Anthropic, nenhum envio real.
// Pré-requisitos: base demo recém-criada, simulador da Anthropic na porta 4020 e o CRM rodando com:
//   WAWEB_HABILITADO=true  WAWEB_SIMULADOR=true  WAWEB_NUMEROS_PERMITIDOS=5511977770001  WAWEB_CONTATOS_TESTE=5511966660001
//   ANTHROPIC_API_KEY=<qualquer>  ANTHROPIC_BASE_URL=http://127.0.0.1:4020   (exportadas no ambiente do servidor)
// Uso: node scripts/testes/e2e-operacao.cjs "<senha admin>" "<senha equipe>" [fase]
//   fase "reinicio": após reiniciar o servidor, confere que vendas, financeiro e produção continuam gravados.
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const BASE = process.env.BASE || "http://localhost:3000";
const MOCK = process.env.MOCK_ANTHROPIC || "http://127.0.0.1:4020";
const CHIP = "5511977770001";
const CONTATO = "5511966660001";
const NOME = "Cliente Integrado";
const [adminPw, teamPw, fase] = process.argv.slice(2);
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-op-"));
const pngFile = (name) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, Buffer.from(PNG_B64, "base64"));
  return f;
};
let fails = 0;
const ok = (c, m) => {
  console.log((c ? "  ✔ " : "  ✘ ") + m);
  if (!c) fails++;
};

async function login(p, email, pw) {
  await p.context().clearCookies();
  await p.goto(BASE + "/login");
  await p.fill("#email", email);
  await p.fill("#password", pw);
  await p.click("button[type=submit]");
  await p.waitForURL("**/dashboard");
}
const sim = (p, body) => p.request.post(BASE + "/api/whatsapp-web/simulador", { data: body }).then((r) => r.status());
const visible = (p, sel, timeout = 8000) => p.waitForSelector(sel, { timeout }).then(() => true, () => false);

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await login(p, "admin@pontodigital.demo", adminPw);

  if (fase === "reinicio") {
    console.log("B. Persistência após reiniciar o servidor");
    await p.goto(BASE + "/vendas");
    ok(await visible(p, `[data-sale="1"]:has-text("Pago")`), "venda nº 1 continua paga");
    await p.goto(BASE + "/financeiro");
    ok(await visible(p, `[data-entry*="Venda nº 1"]`), "lançamento da venda continua no financeiro");
    await p.goto(BASE + "/producao");
    ok(await visible(p, `[data-order="1"]:has-text("Entregue")`), "ordem de produção continua entregue");
    await p.goto(BASE + "/biblioteca");
    ok(await visible(p, `[data-asset="Catálogo de teste"]`), "arquivo da biblioteca continua disponível");
    const img = await p.request.get(BASE + (await p.getAttribute(`[data-asset="Catálogo de teste"] img`, "src")));
    ok(img.status() === 200 && (img.headers()["content-type"] || "").startsWith("image/"), "arquivo da biblioteca é servido após o reinício");
    await p.goto(BASE + "/guardian");
    ok(await visible(p, "text=Servidor iniciado; monitoramento ativo."), "Guardian registrou o reinício");
    const manual = await p.locator("#name option", { hasText: "manual" }).first().getAttribute("value");
    await p.selectOption("#name", manual);
    await p.fill("#confirm", "RESTAURAR");
    await p.click('button:has-text("Restaurar")');
    ok(await visible(p, "text=O estado anterior foi guardado em"), "restauração de backup com cópia de segurança do estado atual");
    await p.goto(BASE + "/vendas");
    ok(await visible(p, `[data-sale="1"]:has-text("Pago")`), "dados íntegros após a restauração");
  } else {
    console.log("1. Atendimento pelo WhatsApp Web (simulador)");
    await p.goto(BASE + "/configuracoes/whatsapp-web");
    await p.click('button:has-text("Conectar chip de teste")');
    await p.waitForSelector('[data-testid="waweb-qr"]');
    await sim(p, { acao: "escanear", numero: CHIP });
    await p.waitForSelector('[data-testid="waweb-status"]:has-text("Conectado")');
    ok(true, "chip de teste conectado");
    ok((await sim(p, { acao: "mensagem", de: CONTATO, texto: "Oi! Quero um logotipo, quanto custa?", nome: NOME })) === 200, "cliente envia mensagem");

    console.log("2. IA sugere a resposta (simulador da Anthropic)");
    await p.goto(BASE + "/ia");
    await p.fill('textarea[name="services"]', "[TESTE] Texto provisório para o teste integrado.");
    if (!(await p.isChecked('input[name="enabled"]'))) await p.check('input[name="enabled"]');
    await p.click('button:has-text("Salvar base de conhecimento")');
    ok(await visible(p, "text=IA ativa"), "IA ativada no modo de testes");
    await p.goto(BASE + "/inbox");
    await p.click(`a:has-text("${NOME}")`);
    await p.waitForSelector("text=Oi! Quero um logotipo, quanto custa?");
    await p.click('button[aria-label="Sugerir resposta com IA"]');
    ok(await visible(p, "text=Sugestão da IA — revise antes de enviar."), "sugestão aparece para revisão");
    const draft = await p.inputValue('textarea[name="body"]');
    ok(draft.length > 10, "texto sugerido vai para a caixa de mensagem (nada enviado ainda)");
    await p.click('button[aria-label="Enviar"]');
    ok(await visible(p, `li:has-text("${draft.slice(0, 30)}")`), "atendente envia após revisar (envio simulado)");
    const log = await (await fetch(MOCK + "/__log")).json();
    ok(log.length >= 1 && log.at(-1).headers.key === "presente", "IA chamada pelo servidor com a chave (simulador)");

    console.log("3. Cliente manda o comprovante pelo WhatsApp → biblioteca");
    ok((await sim(p, { acao: "mensagem", de: CONTATO, texto: "Segue o comprovante do Pix", midia: { tipo: "image", mime: "image/png", base64: PNG_B64 } })) === 200, "imagem recebida");
    await p.reload();
    ok(await visible(p, 'img[alt="Segue o comprovante do Pix"]'), "imagem exibida na conversa a partir da biblioteca");

    console.log("4. Venda registrada a partir da conversa");
    await p.click('a:has-text("Registrar venda")');
    await p.waitForURL("**/vendas?cliente=*");
    await p.fill('input[aria-label="Descrição do item 1"]', "Logotipo");
    await p.fill('input[aria-label="Valor unitário do item 1"]', "1500,00");
    await p.click('button:has-text("Registrar venda")');
    ok(await visible(p, "text=Venda nº 1 registrada. Aguardando pagamento."), "venda nº 1 aguardando pagamento");
    ok(await visible(p, `[data-sale="1"]:has-text("Aguardando pagamento")`), "venda listada com o status correto");

    console.log("5. Comprovante lido pela IA e confirmado pelo Financeiro");
    await fetch(MOCK + "/__comprovante", { method: "POST", body: JSON.stringify({ valor: "R$ 1.500,00", pagador: NOME, id_transacao: "E2E000000000000001" }) });
    await p.goto(BASE + "/financeiro");
    await p.setInputFiles('input[name="file"]', pngFile("comprovante-pix.png"));
    await p.click('button:has-text("Enviar e ler")');
    await p.waitForURL("**/financeiro/comprovantes/*");
    ok((await p.inputValue("#valor")) === "1500,00", "IA leu o valor do comprovante");
    ok((await p.inputValue("#pagador")) === NOME, "IA leu o pagador");
    ok((await p.locator("#saleId option:checked").innerText()).includes("valor exato"), "venda compatível sugerida (valor exato)");
    await p.click('button:has-text("Confirmar pagamento")');
    ok(await visible(p, "text=Pagamento confirmado") && (await visible(p, 'a:has-text("nº 1")')), "confirmação humana dá baixa e vincula o comprovante à venda");

    console.log("6. Financeiro e vendas atualizados");
    await p.goto(BASE + "/financeiro");
    ok(await visible(p, `[data-entry*="Venda nº 1"]`), "entrada lançada no financeiro");
    ok(await visible(p, "text=R$ 1.500,00"), "valor da entrada no resumo do mês");
    await p.goto(BASE + "/vendas");
    ok(await visible(p, `[data-sale="1"]:has-text("Pago")`), "venda marcada como paga");

    console.log("7. Comprovante repetido é barrado");
    await p.goto(BASE + "/financeiro");
    await p.setInputFiles('input[name="file"]', pngFile("comprovante-copia.png"));
    await p.click('button:has-text("Enviar e ler")');
    await p.waitForURL("**/financeiro/comprovantes/*");
    ok(await visible(p, "text=Possível comprovante repetido"), "mesmo ID de transação marcado como duplicado");
    await p.fill("#reason", "Comprovante repetido (teste)");
    await p.click('button:has-text("Rejeitar comprovante")');
    ok(await visible(p, 'span:has-text("Rejeitado")'), "duplicado rejeitado");

    console.log("8. Produção");
    await p.goto(BASE + "/producao");
    ok(await visible(p, '[aria-label="Na fila"] [data-order="1"]'), "ordem nº 1 na fila com o item vendido");
    await p.click('button[aria-label="Avançar — ordem 1"]');
    await p.waitForSelector('[aria-label="Em produção"] [data-order="1"]');
    await p.click('button[aria-label="Avançar — ordem 1"]');
    await p.waitForSelector('[aria-label="Revisão / aprovação"] [data-order="1"]');
    ok(true, "ordem avança: fila → produção → revisão");
    await p.click('button[aria-label="Concluir: Logotipo"]');
    await p.waitForSelector('button[aria-label="Desmarcar: Logotipo"]');
    await p.click('button[aria-label="Entregar — ordem 1"]');
    ok(await visible(p, `[data-order="1"]:has-text("Entregue")`), "checklist concluído e ordem entregue");

    console.log("9. Biblioteca de mídias");
    await p.goto(BASE + "/biblioteca");
    ok(await visible(p, '[data-asset]:has-text("Recebido (WhatsApp Web)")'), "imagem do WhatsApp Web está na biblioteca");
    await p.setInputFiles('input[name="file"]', pngFile("catalogo.png"));
    await p.fill("#title", "Catálogo de teste");
    await p.fill("#tags", "catálogo, teste");
    await p.click('button:has-text("Enviar para a biblioteca")');
    ok(await visible(p, '[data-asset="Catálogo de teste"]'), "arquivo enviado pela equipe");
    await p.setInputFiles('input[name="file"]', { name: "falso.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script>") });
    await p.click('button:has-text("Enviar para a biblioteca")');
    ok(await visible(p, "text=O conteúdo do arquivo não corresponde ao tipo informado."), "arquivo disfarçado é recusado");
    const card = p.locator('[data-asset="Catálogo de teste"]');
    await card.locator("summary").click();
    await card.locator('button:has-text("Registrar envio (simulado)")').click();
    ok(await visible(p, "text=Registrado na conversa (envio simulado"), "arquivo usado na conversa sem envio real");
    await p.goto(BASE + "/inbox");
    await p.click(`a:has-text("${NOME}")`);
    ok(await visible(p, "text=Catálogo de teste"), "mensagem com o arquivo aparece no atendimento");

    console.log("10. Guardian");
    await p.goto(BASE + "/guardian");
    ok(await visible(p, '[data-check="ai"][data-status="ok"]'), "verificação da IA em ordem");
    ok(await visible(p, '[data-check="waweb"][data-status="ok"]'), "WhatsApp Web conectado e monitorado");
    ok(await visible(p, '[data-check="locks"][data-status="ok"]'), "travas de envio ativas");
    await p.click('button:has-text("Fazer backup agora")');
    ok(await visible(p, "text=Backup criado."), "backup manual criado");
    await p.fill("#confirm", "errado");
    await p.click('button:has-text("Restaurar")');
    ok(await visible(p, "text=Digite RESTAURAR para confirmar."), "restauração exige confirmação explícita");
    const health = await p.request.get(BASE + "/api/health");
    const hj = await health.json();
    ok(health.status() === 200 && ["ok", "aviso"].includes(hj.status) && !JSON.stringify(hj).includes("sk-"), "/api/health responde sem expor segredos");
    const anon = await (await b.newContext()).request.get(BASE + "/api/health");
    ok(anon.status() === 200, "/api/health acessível sem login (monitor externo)");

    console.log("11. Permissões da atendente");
    await login(p, "ana@pontodigital.demo", teamPw);
    await p.goto(BASE + "/financeiro");
    ok(await p.waitForURL("**/sem-permissao", { timeout: 8000 }).then(() => true, () => false), "atendente não acessa o Financeiro");
    await p.goto(BASE + "/guardian");
    ok(await p.waitForURL("**/sem-permissao", { timeout: 8000 }).then(() => true, () => false), "atendente não acessa o Guardian");
    await p.goto(BASE + "/producao");
    ok(await visible(p, "h1:has-text('Produção')"), "atendente acessa a Produção");
    await p.goto(BASE + "/vendas");
    ok(!(await p.isVisible("text=Dar baixa manual")), "atendente não dá baixa em pagamento");
    const receiptImg = await p.request.get(BASE + "/api/biblioteca/00000000-0000-0000-0000-000000000000");
    ok(receiptImg.status() === 404, "arquivo inexistente: 404");
  }
  ok(errors.length === 0, `sem erros de JavaScript no navegador${errors.length ? ": " + errors.join(" | ") : ""}`);
  await b.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `\n${fails} falha(s)` : "\nTodos os cenários passaram");
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
