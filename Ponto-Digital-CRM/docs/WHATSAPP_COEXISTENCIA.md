# WhatsApp Business no celular **e** no CRM (coexistência oficial da Meta)

**Resposta curta:** sim, é possível usar o mesmo número ao mesmo tempo no app WhatsApp Business do celular e no Ponto Digital CRM, pelo recurso oficial da Meta chamado **coexistência** (*WhatsApp Business App Coexistence*), que liga o número do app à WhatsApp Cloud API **sem migrar**, sem trocar de número e sem perder as conversas.

> Nenhuma ação foi feita no seu número. O CRM só usa integrações oficiais da Meta. A conexão acontece apenas quando um administrador clica em **Conectar** no CRM e você escaneia o QR Code **no próprio app** do celular.

## 1. Análise de compatibilidade (outubro/2026)

| Requisito da Meta | Situação da Ponto Digital |
| --- | --- |
| Número já em uso no app **WhatsApp Business** | ✅ É o seu caso |
| App **WhatsApp Business 2.24.17 ou superior** | Confira em *Configurações → Ajuda → Informações do app* (atualize pela loja se preciso) |
| Código do país suportado | ✅ Brasil (+55) é suportado |
| Uso ativo do número no app (parceiros citam pelo menos 7 dias de conversas reais) | Provável ✅ — a elegibilidade final é confirmada pela própria Meta durante a conexão |
| Conexão feita por um **Tech Provider** ou **Parceiro de Soluções** da Meta, com *Embedded Signup* | Ver os caminhos A e B abaixo |
| Webhook HTTPS que receba os eventos de coexistência | ✅ Pronto no CRM publicado no Render |

**O que muda no app depois da conexão (regras da Meta):**
- O app continua no celular, com as mesmas conversas. É preciso **abrir o app pelo menos a cada 14 dias**, senão a Meta desfaz a conexão.
- Aparelhos vinculados (WhatsApp Web / computador) são **desconectados na hora da conexão** e podem ser vinculados de novo. Mensagens enviadas pelo WhatsApp para Windows e por relógios não chegam ao CRM.
- **Histórico:** até **6 meses** de conversas individuais, **uma única vez**, se você autorizar no app durante a conexão (e no prazo de 24h). **Grupos não são sincronizados.**
- Mensagens temporárias e de visualização única ficam desativadas; listas de transmissão viram somente leitura; editar ou apagar mensagem não é repassado ao CRM.
- Limite de envio pela API em coexistência: 20 mensagens por segundo (suficiente para atendimento).
- **Custos:** mensagens enviadas pelo app continuam **gratuitas**. Pela API, a Meta cobra por **modelo (template)** entregue, conforme a tabela vigente para o Brasil — respostas em texto livre dentro da janela de 24h após a mensagem do cliente não são cobradas. Campanhas de marketing são o tipo mais caro.
- Para desconectar a qualquer momento: no celular, **WhatsApp Business → Configurações → Conta → Plataforma comercial → Desconectar**. O app continua funcionando.

Fontes: [Meta — Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/), [Meta — Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/), [360dialog — Coexistence](https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence), [YCloud — Coexistence](https://www.ycloud.com/blog/whatsapp-business-app-coexistence-meta-update), [ChakraHQ — suporte por país](https://chakrahq.com/product/whatsapp/tools/whatsapp-coexistence-support/). Desde 15/10/2026 a Meta aceita apenas a versão atual do Embedded Signup — o CRM já usa esse formato.

## 2. Dois caminhos oficiais para conectar

| | **A. Ponto Digital como Tech Provider** (recomendado) | **B. Parceiro de Soluções da Meta (BSP)** |
| --- | --- | --- |
| Como é | O app da própria Ponto Digital na Meta; o botão **Conectar** do CRM abre o Embedded Signup | O parceiro faz a conexão por coexistência e entrega acesso à Cloud API |
| Custo fixo | Nenhum (só as mensagens da Meta) | Mensalidade do parceiro |
| Prazo | Verificação da empresa + análise do app pela Meta (normalmente dias a algumas semanas) | Rápido (às vezes no mesmo dia) |
| Controle | Total: a conta fica no seu portfólio e o token fica criptografado no CRM | Depende do parceiro (exija conta no **seu** portfólio e token próprio) |
| Bônus | A agência pode oferecer o mesmo serviço aos clientes dela | — |

No caminho B, o CRM usa o botão **Vincular número do servidor** (credenciais do parceiro nas variáveis do Render). O CRM fala a Cloud API padrão da Meta (`graph.facebook.com`); parceiros com API própria exigiriam adaptação.

### Se a coexistência não estiver disponível para o seu número
**Não fazemos migração convencional** (ela tiraria o número do app). Alternativas, todas com sua autorização:
1. **Aguardar e tentar de novo** — atualizar o app, usar o número normalmente por mais alguns dias e repetir a conexão.
2. **Segundo número só para a API** — o número atual segue no app como hoje e um número novo atende pelo CRM.
3. **Migração convencional** — somente se você decidir, sabendo que o número sai do app.

## 3. O que já está pronto no CRM

| Item | Onde |
| --- | --- |
| Botão oficial de conexão (Embedded Signup, fluxo de coexistência); **nunca** chama o registro do número | Configurações → WhatsApp Business |
| Token da conexão guardado **criptografado** (AES-256-GCM) — ninguém o vê nem copia | tabela `whatsapp_accounts` (sem acesso para usuários) |
| Pedido automático de sincronização de **contatos** e **histórico** logo após conectar (prazo da Meta: 24h) | `configuracoes/whatsapp/actions.ts` |
| Webhook com assinatura `X-Hub-Signature-256` validada antes de ler o conteúdo | `api/webhooks/whatsapp` |
| Gravação idempotente no Supabase por função segura do banco (sem duplicar mensagens) | `wa_ingest_event` / `wa_ingest_batch` |
| Mensagens do cliente, ecos do app (o que você responde pelo celular), histórico, contatos, status de entrega e aprovação de modelos | `lib/whatsapp/events.ts` |
| Imagens, áudios, vídeos e documentos (recebidos e enviados); arquivos baixados da Meta sob demanda, só para quem pode ver a conversa | `api/whatsapp/midia`, `api/whatsapp/enviar-midia` |
| Cliente novo cadastrado automaticamente (sem presumir consentimento de marketing) e incluído no funil | banco |
| Distribuição dos novos atendimentos: manual ou **rodízio** entre a equipe | Equipe e permissões |
| Modelos enviados para análise da Meta e sincronizados | Modelos e respostas |
| Sugestões de resposta por IA, sempre revisadas por uma pessoa | [IA.md](IA.md) |

## 4. Travas: teste × produção

| Variável (Render) | Valor seguro | Efeito |
| --- | --- | --- |
| `WHATSAPP_SEND_MODE` | `simulacao` | Nada é enviado. Com `live`, envia de verdade (respeitando as travas abaixo). |
| `WHATSAPP_AMBIENTE` | `teste` | Em teste, o envio real só vai para `WHATSAPP_NUMEROS_TESTE` (celulares da equipe); clientes são recusados. `producao` libera clientes reais. |
| `WHATSAPP_NUMEROS_TESTE` | celulares da equipe | Ex.: `5511999990000,5511988880000` |
| `WHATSAPP_CAMPAIGNS_LIVE` | `false` | Campanhas sempre simuladas. `true` libera campanhas reais (máx. 250 contatos por execução, só com opt-in). |

Receber mensagens funciona em qualquer modo: o que você recebe nunca é bloqueado. A IA **apenas sugere** — não existe resposta automática nesta versão.

## 5. Passo a passo das ações que dependem de você

Caminho A. Faça **uma de cada vez**; me avise ao concluir cada uma, que eu confiro antes da próxima.

1. **Verificar a empresa na Meta.** Em [business.facebook.com](https://business.facebook.com) → ⚙️ **Configurações** → **Central de segurança** → **Iniciar verificação**. Envie CNPJ e comprovante de endereço da Ponto Digital. (Se já estiver verificada, pule.)
2. **Criar o app da Ponto Digital.** Em [developers.facebook.com](https://developers.facebook.com) → **Meus apps** → **Criar app** → caso de uso **"Outro"** → tipo **"Empresa"** → nome "Ponto Digital CRM" → selecione o portfólio da Ponto Digital. No painel do app, em **Adicionar produtos**, clique em **Configurar** no **WhatsApp**.
3. **Guardar os segredos no Render** (eu não preciso vê-los): no seu computador, na pasta do CRM, rode `npm run whatsapp:chave` (gera `WHATSAPP_TOKEN_KEY` e `WHATSAPP_VERIFY_TOKEN`). No app da Meta: **Configurações do app → Básico** → copie **ID do aplicativo** e **Chave secreta do aplicativo**. No Supabase: **Project Settings → API Keys** → copie a **secret key**. No Render: serviço **ponto-digital-crm → Environment → Add Environment Variable** e cadastre: `META_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TOKEN_KEY`, `WHATSAPP_VERIFY_TOKEN`, `SUPABASE_SECRET_KEY`. Clique **Save, rebuild, and deploy**.
4. **Ligar o webhook.** No app da Meta → **WhatsApp → Configuração** → **Webhook → Editar**: URL `https://ponto-digital-crm.onrender.com/api/webhooks/whatsapp` e o mesmo `WHATSAPP_VERIFY_TOKEN` → **Verificar e salvar**. Em **Campos do webhook**, clique **Assinar** em: `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `message_template_status_update`.
5. **Criar a configuração do Embedded Signup.** No app → **Adicionar produto → Login do Facebook para Empresas** → **Configurações** → **Criar configuração** → escolha **Cadastro incorporado do WhatsApp (WhatsApp Embedded Signup)** → permissões `whatsapp_business_management` e `whatsapp_business_messaging` → salve e copie o **ID da configuração**. Em **Configurações do Login**, adicione `https://ponto-digital-crm.onrender.com` como domínio permitido. No Render, cadastre `META_ES_CONFIG_ID` com esse ID.
6. **Tornar o app um Tech Provider.** No painel do app → **Revisão do app** → solicite **acesso avançado** para `whatsapp_business_management` e `whatsapp_business_messaging` e conclua o cadastro de **Tech Provider** que a Meta indicar. Aguarde a aprovação (a Meta avisa por e-mail).
7. **Conectar o número** (🔒 altera a configuração do número — só você executa). No CRM: **WhatsApp Business** → marque a caixa de ciência → **Conectar meu WhatsApp Business (coexistência)** → entre com o Facebook da Ponto Digital → escolha conectar o **app WhatsApp Business existente** → no celular, escaneie o **QR Code** e decida se compartilha o histórico.
8. **Testar com a equipe** (🔒). No Render: `WHATSAPP_NUMEROS_TESTE` com os celulares da equipe e `WHATSAPP_SEND_MODE=live` (mantendo `WHATSAPP_AMBIENTE=teste`). Mande mensagens dos celulares da equipe para o número da Ponto Digital e responda pelo CRM e pelo app.
9. **Atender clientes reais** (🔒 sua aprovação final). No Render: `WHATSAPP_AMBIENTE=producao`. Campanhas continuam simuladas até você decidir `WHATSAPP_CAMPAIGNS_LIVE=true`.
