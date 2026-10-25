# WhatsApp Web por QR Code — módulo experimental

> **Não oficial.** Este módulo usa o protocolo do WhatsApp Web (biblioteca [Baileys](https://github.com/WhiskeySockets/Baileys), licença MIT) sem autorização da Meta. Viola os termos de uso do WhatsApp e **pode levar ao banimento do número vinculado**. Use **somente um chip de teste**, nunca o número principal. Para atender clientes, use a integração oficial ([WHATSAPP_COEXISTENCIA.md](WHATSAPP_COEXISTENCIA.md)), que continua intacta e separada.

## O que faz

- Gera um QR Code na tela **WhatsApp Web (teste)** (menu de administração, só administradores).
- Depois que o chip de teste lê o QR Code, as mensagens **recebidas** de contatos de teste entram no Atendimento, pelo mesmo caminho do webhook oficial (cliente criado ou atualizado, conversa, janela de 24h, descadastro por "SAIR").
- Mensagens que o próprio celular envia aparecem na conversa como enviadas pelo app.
- **Não envia nada.** O módulo não tem função de envio. Respostas escritas no CRM seguem as travas da API oficial (`WHATSAPP_SEND_MODE=simulacao` por padrão).

## Travas

| Trava | Como funciona |
| --- | --- |
| Desligado por padrão | `WAWEB_HABILITADO=false` |
| Só chips de teste | Se o número que ler o QR Code não estiver em `WAWEB_NUMEROS_PERMITIDOS`, o aparelho é desvinculado na hora, a sessão é apagada e nenhuma mensagem é lida |
| Só contatos de teste | Mensagens de quem não está em `WAWEB_CONTATOS_TESTE` (ou `WHATSAPP_NUMEROS_TESTE`) são contadas e descartadas, sem gravar |
| Sem grupos | Grupos, listas de transmissão, status e canais são ignorados |
| Discreto | Não baixa o histórico do celular e não marca o CRM como "online" |
| Sessão protegida | Criptografada com AES-256-GCM (`WAWEB_SESSION_KEY`); no banco, só o servidor lê (RLS sem políticas) |
| Simulador isolado | `WAWEB_SIMULADOR=true` só funciona localmente: o CRM recusa iniciar publicado com ele |
| Permissões | Tela, status e simulador exigem o perfil Administrador; ações ficam na auditoria (`whatsapp_web.*`) |

## Sessão na hospedagem (Render)

O disco do Render é apagado a cada deploy, por isso a sessão fica no Supabase (tabela `public.waweb_sessions`, migração `20261026000000_whatsapp_web_experimental.sql`). Quando o servidor reinicia, o CRM retoma a sessão sozinho (`src/instrumentation.ts`), sem novo QR Code. A conexão roda dentro do próprio processo do CRM: não precisa de worker pago, mas fica fora do ar por alguns segundos durante cada deploy.

Variáveis no Render (aba Environment), somente quando for testar:

```
WAWEB_HABILITADO=true
WAWEB_NUMEROS_PERMITIDOS=55DDDNUMERO_DO_CHIP_DE_TESTE
WAWEB_CONTATOS_TESTE=55DDDCELULAR_DA_EQUIPE_1,55DDDCELULAR_DA_EQUIPE_2
WAWEB_SESSION_KEY=(gere com npm run whatsapp:chave)
SUPABASE_SECRET_KEY=(já usada pelo webhook oficial)
```

No modo demonstração (computador), a sessão fica em `.data/whatsapp-web/` e a chave é derivada do `SESSION_SECRET` local.

## Limitações

- Pode parar de funcionar quando o WhatsApp mudar o protocolo, até a biblioteca ser atualizada.
- O celular do chip precisa entrar na internet periodicamente; após cerca de 14 dias offline o aparelho é desvinculado.
- Ocupa uma das 4 vagas de aparelhos conectados.
- Imagens, áudios e documentos aparecem como descrição (`[imagem] legenda`), sem o arquivo.
- Uma conexão por servidor (uma organização).

## Testes

```bash
npm test                                                     # inclui tests/whatsapp-web.test.ts (12 testes)
createdb pdcrm_waweb && psql -d pdcrm_waweb -f supabase/tests/whatsapp-web-test.sql   # 9 verificações
```

Ponta a ponta com o simulador (25 cenários, nunca conecta um WhatsApp real): coloque no `.env.local`

```
WAWEB_HABILITADO=true
WAWEB_SIMULADOR=true
WAWEB_NUMEROS_PERMITIDOS=5511977770001
WAWEB_CONTATOS_TESTE=5511966660001
```

e rode `npm run demo:reset && npm run build && npm start` em um terminal e, em outro,
`node scripts/testes/e2e-whatsapp-web.cjs "<senha admin>" "<senha equipe>"`. Depois reinicie o servidor e rode o mesmo comando com `reinicio` no final para conferir a retomada da sessão.

O primeiro teste com um chip real deve ser feito no computador ou no Render: o ambiente de desenvolvimento na nuvem não alcança os servidores do WhatsApp.
