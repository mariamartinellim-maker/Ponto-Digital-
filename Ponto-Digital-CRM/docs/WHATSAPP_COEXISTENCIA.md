# Integração oficial do WhatsApp com coexistência

Objetivo: conectar o **número que você já usa no aplicativo WhatsApp Business** ao CRM pela **WhatsApp Cloud API oficial da Meta**, sem perder o aplicativo nem as conversas, usando o recurso de **coexistência** (App Business + Cloud API no mesmo número).

> **Nada disso foi executado.** Nenhuma ação foi feita no seu número. Cada etapa marcada com 🔒 só acontece com a sua autorização expressa.
> Não usamos APIs não oficiais, bibliotecas que imitam o WhatsApp Web nem automações de navegador.

## Como funciona a coexistência

- O número continua ativo no **aplicativo WhatsApp Business** no celular; ao mesmo tempo, passa a ser acessível pela **Cloud API**.
- A conexão é feita por **Embedded Signup** (cadastro incorporado da Meta) oferecido por um **Parceiro de Soluções / Tech Provider** compatível. No final, você escaneia um QR Code no próprio aplicativo.
- Durante o cadastro, o aplicativo pergunta se você quer **compartilhar o histórico** de conversas. Se autorizar, a Meta envia o histórico pelo webhook `history`.
- Mensagens que você enviar **pelo aplicativo** chegam ao CRM pelo webhook `smb_message_echoes` (aparecem como "Enviada pelo app WhatsApp Business").
- Contatos do aplicativo podem ser sincronizados pelo webhook `smb_app_state_sync`.

**Condições e limitações mudam com o tempo** (países atendidos, versão mínima do app, tipos de mensagem não sincronizados, limites de envio, necessidade de abrir o app periodicamente). Antes de qualquer passo, confirmaremos as regras vigentes na documentação da Meta e com o parceiro escolhido.

## O que já está pronto no CRM

| Item | Onde |
| --- | --- |
| Webhook com verificação (`GET hub.challenge`) e recebimento (`POST`) | `src/app/api/webhooks/whatsapp/route.ts` |
| Validação da assinatura `X-Hub-Signature-256` (HMAC-SHA256 com o App Secret) antes de ler o conteúdo | `src/lib/whatsapp/signature.ts` |
| Leitura dos campos `messages`, `statuses`, `smb_message_echoes`, `history`, `smb_app_state_sync` | `src/lib/whatsapp/events.ts` |
| Processamento idempotente (eventos repetidos são ignorados), criação automática de cliente/conversa, status de entrega/leitura, descadastro por "SAIR" | `src/lib/data/repo.ts` → `applyWhatsAppEvents` |
| Envio de texto e de modelos pela Graph API, com travas | `src/lib/whatsapp/client.ts` |
| Regra da janela de 24h e uso obrigatório de modelos aprovados fora dela | `src/lib/inbox.ts`, tela de conversa |
| Simuladores na interface que usam **o mesmo processador** dos webhooks reais | botões "Simular" na conversa e na campanha |

## Travas de segurança

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `WHATSAPP_SEND_MODE` | `simulacao` | Nenhuma mensagem sai para o WhatsApp. Só registra no CRM. |
| `WHATSAPP_CAMPAIGNS_LIVE` | `false` | Campanhas nunca enviam de verdade. Nesta versão, campanhas reais são recusadas mesmo que a variável seja alterada. |
| `NODE_ENV=test` | — | Testes automatizados nunca enviam, em nenhuma configuração. |
| `WHATSAPP_APP_SECRET` ausente | — | O webhook responde 503 e não processa nada. |

## Plano de execução

1. **Elegibilidade** — conferir com um parceiro compatível se o seu número pode usar coexistência e quais os custos (a Meta cobra por conversa/mensagem conforme a categoria; o parceiro pode ter mensalidade). 🔒 *Contratar parceiro gera custo: só com sua autorização.*
2. **Meta for Developers** — você cria (ou nós orientamos) o app do tipo Business e a conta WhatsApp Business (WABA) no seu Business Manager. Nenhuma alteração no número.
3. **Publicar o CRM em HTTPS** (ex.: Render) — a Meta só entrega webhooks para endereço público. 🔒 *Publicação: só com sua autorização.*
4. **Cadastrar segredos** no painel da hospedagem: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN` (token de usuário do sistema), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`. Nunca no código nem em mensagens.
5. **Cadastrar o webhook** no app da Meta: URL `https://SEU-DOMINIO/api/webhooks/whatsapp`, token de verificação, e assinar `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`.
6. **Onboarding com coexistência** — você escaneia o QR Code no app WhatsApp Business e escolhe se compartilha o histórico. 🔒 *Altera a configuração do seu número: só você executa, com a sua aprovação.*
7. **Testes controlados** — `WHATSAPP_SEND_MODE=live` apenas para mensagens individuais para números internos da equipe. Campanhas continuam em simulação. 🔒
8. **Modelos** — submeter os modelos à aprovação da Meta e sincronizar o status. 🔒
9. **Liberar campanhas** — após revisão de modelos, público e custos. Exige uma alteração de código consciente além da variável. 🔒

## Teste local do webhook (sem a Meta)

Com `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` definidos no `.env.local`:

```bash
# Verificação
curl "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=123"

# Evento assinado
BODY='{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"phone_number_id":"1"},"messages":[{"from":"5511900001000","id":"wamid.TESTE1","timestamp":"1761300000","type":"text","text":{"body":"Olá"}}]}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "SEU_APP_SECRET" | sed 's/^.* //')
curl -X POST http://localhost:3000/api/webhooks/whatsapp -H "Content-Type: application/json" -H "X-Hub-Signature-256: sha256=$SIG" -d "$BODY"
```
