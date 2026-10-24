// Teste ponta a ponta (modo demo). Uso: node scripts/e2e.cjs "<senha admin>" "<senha equipe>" "$PWD"
// Requer Playwright (npm i -D playwright && npx playwright install chromium) e o sistema rodando com base recém-criada.
const { chromium } = require('playwright');
const fs = require('fs');
const [adminPw, teamPw, root] = process.argv.slice(2);
const BASE = 'http://localhost:3000';
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) failures++; };

async function login(p, email, pw) {
  await p.goto(BASE + '/login');
  await p.fill('#email', email); await p.fill('#password', pw);
  await p.click('button[type=submit]');
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));

  console.log('1. Autenticação');
  await p.goto(BASE + '/clientes');
  ok(p.url().includes('/login?next=%2Fclientes'), 'rota protegida redireciona para login');
  await login(p, 'admin@pontodigital.demo', 'senha-errada-123');
  await p.waitForSelector('text=E-mail ou senha incorretos');
  ok(true, 'senha incorreta é recusada');
  await login(p, 'admin@pontodigital.demo', adminPw);
  await p.waitForURL('**/dashboard');
  ok(true, 'login do administrador');

  console.log('2. Cadastro de cliente');
  await p.goto(BASE + '/clientes/novo');
  await p.fill('#name', 'Cliente Teste E2E');
  await p.fill('#phone', '(11) 90000-7777');
  await p.fill('#city', 'Jundiaí');
  await p.check('input[name=services][value="SEO"]');
  await p.check('input[name=consent]');
  await p.click('button:has-text("Cadastrar cliente")');
  await p.waitForURL(/\/clientes\/[0-9a-f-]{36}$/);
  await p.waitForSelector('text=Consentimento (LGPD)');
  ok(await p.isVisible('text=Aceita WhatsApp'), 'cliente criado com consentimento registrado');
  const clientUrl = p.url();
  await p.goto(BASE + '/clientes/novo');
  await p.fill('#name', 'Duplicado'); await p.fill('#phone', '11 9000-07777'.replace('9000-0','90000-'));
  await p.click('button:has-text("Cadastrar cliente")');
  await p.waitForSelector('text=Já existe um cliente com este telefone');
  ok(true, 'telefone duplicado é bloqueado');

  console.log('3. Importação CSV');
  const csvPath = root + '/.data/import-test.csv';
  fs.writeFileSync(csvPath, 'nome,telefone,cidade,consentimento\nNovo Lead CSV,(19) 90000-5555,Campinas,sim\nRepetido,19900005555,Campinas,sim\nJá existe,(11) 90000-7777,SP,\nInválido,123,,\n');
  await p.goto(BASE + '/clientes/importar');
  await p.setInputFiles('input[type=file]', csvPath);
  await p.click('button:has-text("Analisar arquivo")');
  await p.waitForSelector('text=Revise antes de importar');
  const stats = await p.$$eval('.text-2xl.font-semibold', els => els.map(e => e.textContent));
  ok(JSON.stringify(stats.slice(-4)) === '["1","1","1","1"]', `análise: 1 novo, 1 duplicado, 1 existente, 1 inválido (${stats.slice(-4)})`);
  await p.check('input[name=consentConfirmed]');
  await p.click('button:has-text("Importar 1 contato")');
  await p.waitForSelector('text=1 contato(s) importado(s)');
  ok(true, 'importação concluída');

  console.log('4. Funil');
  await p.goto(BASE + '/funil');
  const sel = p.locator('select[aria-label^="Mover Cliente Teste E2E"]').first();
  await sel.selectOption('proposta_enviada');
  await p.waitForTimeout(1500);
  await p.reload();
  const val = await p.locator('select[aria-label^="Mover Cliente Teste E2E"]').first().inputValue();
  ok(val === 'proposta_enviada', 'oportunidade movida para Proposta Enviada (persistiu)');

  console.log('5. Atendimento');
  await p.goto(clientUrl);
  await p.click('button:has-text("Iniciar conversa")');
  await p.waitForURL(/\/inbox\//);
  await p.waitForSelector('text=/Janela de 24h/');
  ok(await p.isVisible('text=Janela de 24h fechada'), 'sem mensagem do cliente: janela de 24h fechada, exige modelo');
  await p.$eval('details:has(input[name=text])', d => { d.open = true; });
  await p.fill('input[name=text]', 'Oi, quero um orçamento');
  await p.click('button:has-text("Simular")');
  await p.waitForSelector('text=Oi, quero um orçamento');
  await p.waitForSelector('text=Janela de 24h aberta');
  ok(true, 'mensagem recebida abre a janela de 24h');
  await p.fill('textarea[name=body]', '/ola');
  await p.click('button:has-text("/ola")');
  ok((await p.inputValue('textarea[name=body]')).startsWith('Olá! Aqui é da Ponto Digital'), 'resposta rápida inserida via "/"');
  await p.click('button[aria-label=Enviar]');
  await p.waitForSelector('li:has-text("Olá! Aqui é da Ponto Digital") >> nth=0');
  ok(await p.isVisible('[aria-label="Simulada (não enviada)"]'), 'mensagem registrada como simulada (não enviada)');
  await p.$eval('details:has(input[name=text])', d => { d.open = true; });
  await p.fill('input[name=text]', 'SAIR');
  await p.click('button:has-text("Simular")');
  await p.waitForSelector('text=Contato descadastrado das campanhas');
  ok(await p.isVisible('header >> text=Descadastrado'), 'palavra SAIR descadastra o contato');

  console.log('6. Campanhas');
  await p.goto(BASE + '/campanhas/nova');
  await p.fill('#name', 'Campanha E2E');
  await p.selectOption('#templateId', { label: 'diagnostico_gratuito' });
  await p.click('label:has-text("Campinas")');
  await p.waitForTimeout(800);
  await p.click('button:has-text("Salvar como rascunho")');
  await p.waitForURL(/\/campanhas\/[0-9a-f-]{36}$/);
  await p.waitForSelector('input[name=confirm]');
  await p.check('input[name=confirm]');
  await p.click('button:has-text("Executar simulação")');
  await p.waitForSelector('h2:text-is("Resultados")');
  ok(await p.locator('text=Executada (simulação)').first().isVisible(), 'campanha executada em modo simulação');
  await p.click('button:has-text("Simular retornos")');
  await p.waitForTimeout(1500);
  const deliveredTxt = await p.locator('text=Entregues').locator('..').textContent();
  ok(!/Entregues0/.test(deliveredTxt.replace(/\s/g,'')), `status de entrega processados (${deliveredTxt.replace(/\s+/g,' ')})`);

  console.log('7. Agenda');
  await p.goto(BASE + '/agenda');
  await p.fill('#title', 'Tarefa E2E');
  await p.fill('#dueAt', '2030-01-15T10:30');
  await p.click('button:has-text("Agendar")');
  await p.waitForSelector('text=Tarefa E2E');
  ok(true, 'tarefa criada');

  console.log('8. Equipe e permissões');
  await p.goto(BASE + '/equipe');
  await p.fill('#name', 'Atendente E2E'); await p.fill('#email', 'e2e@pontodigital.demo');
  await p.selectOption('#role', 'atendente');
  await p.click('button:has-text("Criar acesso")');
  const msg = await p.textContent('text=/Senha temporária: /');
  const tmpPw = msg.match(/Senha temporária: (\S+)/)[1];
  ok(!!tmpPw, 'usuário criado com senha temporária');

  const p2 = await (await b.newContext()).newPage();
  await login(p2, 'e2e@pontodigital.demo', tmpPw);
  await p2.waitForURL('**/dashboard');
  ok(!(await p2.isVisible('a[href="/equipe"]')), 'atendente não vê menu de administração');
  await p2.goto(BASE + '/equipe');
  await p2.waitForURL('**/sem-permissao', { timeout: 10000 }).catch(() => {});
  ok(p2.url().includes('/sem-permissao'), 'atendente bloqueado em /equipe');
  await p2.goto(BASE + '/campanhas/nova');
  await p2.waitForURL('**/sem-permissao', { timeout: 10000 }).catch(() => {});
  ok(p2.url().includes('/sem-permissao'), 'atendente bloqueado em nova campanha');
  const r = await p2.request.get(BASE + clientUrl.replace(BASE, '') .replace('/clientes/', '/api/clientes/') + '/exportar');
  ok(r.status() === 403, 'atendente não exporta dados (403)');

  // desativar encerra a sessão
  await p.goto(BASE + '/equipe');
  const row = p.locator('li', { hasText: 'e2e@pontodigital.demo' });
  await row.locator('button:has-text("Desativar")').click();
  await p.waitForTimeout(800);
  await p2.goto(BASE + '/dashboard');
  await p2.waitForURL('**/login**', { timeout: 10000 }).catch(() => {});
  ok(p2.url().includes('/login'), 'usuário desativado perde a sessão imediatamente');

  console.log('9. Recuperação de senha');
  const p3 = await (await b.newContext()).newPage();
  await p3.goto(BASE + '/esqueci-senha');
  await p3.fill('#email', 'ana@pontodigital.demo');
  await p3.click('button[type=submit]');
  await p3.waitForSelector('text=Se o e-mail estiver cadastrado');
  await new Promise(r => setTimeout(r, 300));
  const outbox = fs.readFileSync(root + '/.data/outbox.log', 'utf8').trim().split('\n').pop();
  const link = outbox.match(/(http\S+)/)[1];
  await p3.goto(link);
  await p3.fill('#password', 'NovaSenhaSegura2026'); await p3.fill('#confirm', 'NovaSenhaSegura2026');
  await p3.click('button[type=submit]');
  await p3.waitForSelector('text=Senha alterada com sucesso');
  await p3.goto(link);
  await p3.fill('#password', 'OutraSenha2026xx'); await p3.fill('#confirm', 'OutraSenha2026xx');
  await p3.click('button[type=submit]');
  await p3.waitForSelector('text=Link inválido ou expirado');
  ok(true, 'link de redefinição funciona uma única vez');
  await login(p3, 'ana@pontodigital.demo', 'NovaSenhaSegura2026');
  await p3.waitForURL('**/dashboard');
  ok(true, 'login com a nova senha');

  console.log('10. LGPD');
  const exp = await p.request.get(clientUrl.replace('/clientes/', '/api/clientes/') + '/exportar');
  const data = await exp.json();
  ok(exp.status() === 200 && data.titular.name === 'Cliente Teste E2E' && data.consentimentos.length >= 2 && data.mensagens.length >= 2, 'exportação dos dados do titular (JSON)');

  console.log('11. Auditoria');
  await p.goto(BASE + '/auditoria');
  await p.waitForSelector('text=Registros de auditoria');
  await p.waitForSelector('tbody tr');
  for (const a of ['cliente.criado', 'cliente.importacao', 'campanha.executada_simulacao', 'usuario.criado', 'lgpd.exportacao', 'auth.login_falhou']) {
    ok(await p.locator(`code:text-is("${a}")`).count() > 0, `auditoria registra ${a}`);
  }

  console.log('12. Webhook');
  const g1 = await p.request.get(BASE + '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123');
  ok(g1.status() === 403, 'verificação com token errado é recusada');
  const vt = fs.readFileSync(root + '/.env.local', 'utf8').match(/^WHATSAPP_VERIFY_TOKEN=(.*)$/m)[1];
  const g2 = await p.request.get(BASE + `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${vt}&hub.challenge=987`);
  ok(g2.status() === 200 && (await g2.text()) === '987', 'handshake de verificação da Meta');
  const post = await p.request.post(BASE + '/api/webhooks/whatsapp', { data: { object: 'whatsapp_business_account', entry: [] } });
  ok([401, 503].includes(post.status()), `POST sem assinatura válida é recusado (${post.status()})`);

  console.log('\nErros de página:', errors.length ? errors : 'nenhum');
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTODOS OS CENÁRIOS PASSARAM');
  await b.close();
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
