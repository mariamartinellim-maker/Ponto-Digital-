# Roteiro das próximas etapas

Cada etapa é testada antes de ir ao ar. Itens marcados com 🔒 dependem da sua autorização (custo, publicação ou alteração no seu número de WhatsApp).

## Situação atual dos módulos (modo Supabase)

| Módulo | Situação | Etapa que conclui |
| --- | --- | --- |
| Login, recuperação de senha | ✅ funcionando | — |
| Dashboard | ✅ | — |
| Clientes, consentimento, importação, exportação LGPD | ✅ | — |
| Funil comercial | ✅ | — |
| Atendimento (conversas, responsável, resolver, respostas rápidas) | ✅ envio **simulado** | C |
| Agenda | 👁️ somente leitura | B |
| Modelos e respostas rápidas (cadastro) | 👁️ somente leitura | B |
| Campanhas | 👁️ somente leitura; envio sempre simulado | B (simulação) · C 🔒 (envio real) |
| Equipe (convidar, perfis, desativar) | 👁️ somente leitura; novos usuários pelo painel do Supabase | B |
| Anonimização LGPD | indisponível no Supabase | B |
| Mensagens recebidas do WhatsApp (webhook) | indisponível no Supabase | C |

## Etapa A — Publicação na Vercel (atual)
Ver [PUBLICACAO.md](PUBLICACAO.md). Código pronto e testado; falta a sua autorização para levar à `main` e os cliques na Vercel. 🔒 (publicação e plano Pro)

## Etapa B — Concluir os módulos em somente leitura
- **Agenda, respostas rápidas, modelos e campanhas (simulação):** gravação pelo Supabase com a sessão do usuário — o banco já tem as permissões e o RLS prontos (sem chave secreta).
- **Anonimização LGPD:** função segura no banco (`security definer`) executável só por administradores: anonimiza o cadastro e apaga as conversas, preservando o histórico de consentimento.
- **Equipe:** convite por e-mail pelo próprio CRM (Supabase Auth). Exige a **chave secreta** do Supabase **somente no servidor** (variável criptografada na Vercel, nunca no navegador nem no seu computador), usada apenas nessa função, restrita a administradores e registrada na auditoria.

## Etapa C — WhatsApp oficial (Cloud API) com coexistência
Plano detalhado em [WHATSAPP_COEXISTENCIA.md](WHATSAPP_COEXISTENCIA.md). Resumo:
1. Confirmar com um **Parceiro de Soluções/Tech Provider da Meta** se o seu número atual do WhatsApp Business pode usar **coexistência** (app no celular + Cloud API no mesmo número) e os custos envolvidos. 🔒
2. Webhook publicado na Vercel (precisa de HTTPS — por isso a Etapa A vem antes), com validação de assinatura já implementada; gravação das mensagens recebidas no Supabase por função segura usada apenas pelo servidor.
3. Onboarding por QR Code no próprio app WhatsApp Business, escolhendo se o histórico é sincronizado. 🔒 (altera a configuração do seu número — só você executa)
4. Testes com números internos da equipe; depois liberar respostas reais; campanhas por último. 🔒
- Custos da Meta: cobrança por modelo (template) enviado conforme a tabela vigente; respostas dentro da janela de 24h após a mensagem do cliente não têm custo de modelo. Valores confirmados antes de ativar.

## Etapa D — Atendimento em equipe
Já existe: caixa de entrada por cliente, responsável, transferência, status, visão restrita para atendentes. A acrescentar:
- Fila de entrada com distribuição automática (rodízio entre atendentes ativos) ou por serviço.
- Atualização em tempo real (Supabase Realtime) e aviso de nova mensagem.
- Indicadores por atendente (tempo de primeira resposta, conversas resolvidas).

## Etapa E — Agentes de IA para atendimento comercial
Desenho com **controle humano** em níveis, ativados um a um:

| Nível | O que a IA faz | Controle |
| --- | --- | --- |
| 1. Sugestão | Escreve a resposta; o atendente revisa e envia | Nada sai sem clique humano |
| 2. Respostas simples | Responde sozinha a dúvidas frequentes (horário, serviços, portfólio) | Só dentro da janela de 24h, só contatos sem opt-out, regras e textos aprovados por você |
| 3. Apresentação comercial | Explica serviços e faz perguntas de qualificação; move o lead no funil | Passa para humano ao pedir preço fechado, reclamação ou qualquer dúvida fora do roteiro |
| 4. Link de pagamento | Prepara o link (Mercado Pago, Asaas ou Stripe) | **Sempre** com aprovação de um gestor/admin antes do envio; nunca coleta dados de cartão no chat |

Salvaguardas: base de conhecimento (serviços, preços, políticas) editável por você; toda mensagem da IA identificada e auditada; limite mensal de gasto; botão "pausar IA" por conversa e geral. Modelos sugeridos: Claude Haiku para triagem (mais econômico) e Claude Sonnet para respostas comerciais. Chave da API só no servidor. 🔒 (custo por uso da API)

## Ordem recomendada
A (publicar) → B (concluir módulos) → C (WhatsApp, em modo de teste) → D (equipe) → E (IA, começando pelo nível 1).
