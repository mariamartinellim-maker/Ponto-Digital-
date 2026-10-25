// Teste ponta a ponta do WhatsApp Web EXPERIMENTAL com o SIMULADOR (nunca conecta um WhatsApp real).
// Pré-requisitos: base demo recém-criada e o CRM rodando com, no .env.local:
//   WAWEB_HABILITADO=true
//   WAWEB_SIMULADOR=true
//   WAWEB_NUMEROS_PERMITIDOS=5511977770001
//   WAWEB_CONTATOS_TESTE=5511966660001
// Uso: node scripts/testes/e2e-whatsapp-web.cjs "<senha admin>" "<senha equipe>" [fase]
//   fase "reinicio": roda só a verificação após reiniciar o servidor (sessão retomada sem QR Code).
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3000";
const CHIP = "5511977770001";
const PRINCIPAL = "5511955550000";
const CONTATO = "5511966660001";
const [adminPw, teamPw, fase] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => {
  console.log((c ? "  ✔ " : "  ✘ ") + m);
  if (!c) fails++;
};

async function login(p, email, pw) {
  await p.goto(BASE + "/login");
  await p.fill("#email", email);
  await p.fill("#password", pw);
  await p.click("button[type=submit]");
  await p.waitForURL("**/dashboard");
}
const sim = (p, body) => p.request.post(BASE + "/api/whatsapp-web/simulador", { data: body }).then((r) => r.status());
const status = (p) => p.locator('[data-testid="waweb-status"]').innerText();
const waitStatus = (p, text, timeout = 10000) => p.waitForSelector(`[data-testid="waweb-status"]:has-text("${text}")`, { timeout });

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await login(p, "admin@pontodigital.demo", adminPw);

  if (fase === "reinicio") {
    console.log("Reinício do servidor");
    await p.goto(BASE + "/configuracoes/whatsapp-web");
    await waitStatus(p, "Conectado", 15000).catch(() => {});
    ok((await status(p)) === "Conectado", "após reiniciar, a sessão salva é retomada sem novo QR Code");
    ok(!(await p.isVisible('[data-testid="waweb-qr"]')), "nenhum QR Code exibido");
    const r = await sim(p, { acao: "mensagem", de: CONTATO, texto: "Mensagem depois do reinício", nome: "Contato Teste" });
    ok(r === 200, "mensagem recebida após o reinício");
    await p.goto(BASE + "/inbox");
    await p.click('a:has-text("Contato Teste")');
    await p.waitForSelector("text=Mensagem depois do reinício");
    ok(true, "mensagem pós-reinício aparece no atendimento");
    await p.goto(BASE + "/configuracoes/whatsapp-web");
    p.once("dialog", (d) => d.accept());
    await p.click('button:has-text("Desvincular e apagar sessão")');
    await waitStatus(p, "Desligado");
    ok(true, "desvincular apaga a sessão");
  } else {
    console.log("1. Tela e permissões");
    await p.goto(BASE + "/configuracoes/whatsapp-web");
    await waitStatus(p, "Desligado");
    ok(await p.isVisible("text=Use apenas um chip de teste, nunca o número principal"), "aviso de módulo experimental e não oficial");
    ok(await p.isVisible('a[href="/configuracoes/whatsapp-web"]'), "item no menu de administração");
    ok(await p.isVisible('a[href="/configuracoes/whatsapp"]'), "integração oficial preservada no menu");
    await waitStatus(p, "Desligado");
    ok(true, "começa desligado");

    console.log("2. Número fora da lista de teste");
    await p.click('button:has-text("Conectar chip de teste")');
    await p.waitForSelector('[data-testid="waweb-qr"]');
    ok((await p.getAttribute('[data-testid="waweb-qr"]', "src")).startsWith("data:image/png;base64,"), "QR Code exibido como imagem");
    ok((await sim(p, { acao: "escanear", numero: PRINCIPAL })) === 200, "QR lido pelo número principal (simulado)");
    await waitStatus(p, "Número bloqueado");
    ok(await p.isVisible("text=não está em WAWEB_NUMEROS_PERMITIDOS"), "número principal recusado e desvinculado na hora");

    console.log("3. Chip de teste");
    await p.click('button:has-text("Conectar chip de teste")');
    await p.waitForSelector('[data-testid="waweb-qr"]');
    await sim(p, { acao: "escanear", numero: CHIP });
    await waitStatus(p, "Conectado");
    ok(await p.isVisible("text=Chip de teste final 0001"), "chip de teste conectado");

    console.log("4. Mensagens");
    await sim(p, { acao: "mensagem", de: CONTATO, texto: "Olá! Vi o anúncio pelo WhatsApp Web", nome: "Contato Teste" });
    await sim(p, { acao: "mensagem", de: "5511900001111", texto: "Contato real que não é de teste", nome: "Fulano" });
    await sim(p, { acao: "mensagem", de: CONTATO, texto: "mensagem de grupo", grupo: true });
    await sim(p, { acao: "mensagem", de: CONTATO, texto: "Respondi pelo celular", enviadaPeloCelular: true });
    await p.waitForSelector('[data-testid="waweb-received"]:has-text("2")', { timeout: 10000 });
    ok((await p.innerText('[data-testid="waweb-ignored"]')) === "2", "contato fora do teste e grupo ignorados (2)");
    await p.goto(BASE + "/inbox");
    ok(!(await p.isVisible("text=Fulano")), "contato fora do teste não foi gravado");
    await p.click('a:has-text("Contato Teste")');
    await p.waitForSelector("text=Olá! Vi o anúncio pelo WhatsApp Web");
    ok(true, "mensagem recebida aparece no atendimento");
    ok(await p.isVisible("text=Respondi pelo celular"), "mensagem enviada pelo celular registrada");
    ok(await p.isVisible("text=Janela de 24h aberta"), "mensagem recebida abre a janela de 24h");
    await p.fill("textarea[name=body]", "Olá! Resposta de teste pelo CRM");
    await p.click("button[aria-label=Enviar]");
    await p.waitForSelector('li:has-text("Resposta de teste pelo CRM")');
    ok(await p.isVisible('li:has-text("Resposta de teste pelo CRM") [aria-label="Simulada (não enviada)"]'), "resposta pelo CRM fica em simulação (nada enviado)");

    console.log("5. Queda e reconexão");
    await p.goto(BASE + "/configuracoes/whatsapp-web");
    await sim(p, { acao: "queda", codigo: 408 });
    await waitStatus(p, "Reconectando").catch(() => {});
    await waitStatus(p, "Conectado", 15000);
    ok(true, "reconecta sozinho após queda de rede");

    console.log("6. Atendente");
    const t = await (await b.newContext()).newPage();
    await login(t, "ana@pontodigital.demo", teamPw);
    await t.waitForSelector('a[href="/inbox"]');
    ok(!(await t.isVisible('a[href="/configuracoes/whatsapp-web"]')), "atendente não vê o menu");
    await t.goto(BASE + "/configuracoes/whatsapp-web");
    ok(await t.waitForURL("**/sem-permissao", { timeout: 10000 }).then(() => true, () => false), "atendente bloqueado na tela");
    ok((await t.request.get(BASE + "/api/whatsapp-web/status")).status() === 403, "atendente não consulta o status (403)");
    ok((await sim(t, { acao: "escanear", numero: CHIP })) === 403, "atendente não usa o simulador (403)");

    console.log("7. Auditoria");
    await p.goto(BASE + "/auditoria");
    ok(await p.waitForSelector("text=whatsapp_web.conectar", { timeout: 10000 }).then(() => true, () => false), "auditoria registra whatsapp_web.conectar");
  }

  console.log(`\nErros de página: ${errors.length ? errors.join(" | ") : "nenhum"}`);
  if (errors.length) fails++;
  console.log(fails ? `\n${fails} FALHA(S)` : "\nTODOS OS CENÁRIOS PASSARAM");
  await b.close();
  process.exit(fails ? 1 : 0);
})();
