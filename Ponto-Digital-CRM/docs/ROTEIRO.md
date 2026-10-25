# Roteiro das próximas etapas

Cada etapa é testada antes de ir ao ar. Itens marcados com 🔒 dependem da sua autorização (custo, publicação ou alteração no seu número de WhatsApp).

## Situação atual dos módulos (modo Supabase)

| Módulo | Situação |
| --- | --- |
| Login, recuperação de senha, dashboard, clientes, funil | ✅ |
| Atendimento: mensagens reais pelo webhook, envio pela Cloud API, mídias, histórico por cliente | ✅ pronto — envio real só após conectar o número e liberar as travas 🔒 |
| Coexistência com o app WhatsApp Business (Embedded Signup oficial) | ✅ pronto — falta a conexão, feita por você 🔒 ([passo a passo](WHATSAPP_COEXISTENCIA.md#5-passo-a-passo-das-ações-que-dependem-de-você)) |
| Equipe: convite por e-mail, perfis, desativação, rodízio de atendimentos | ✅ |
| Agenda, respostas rápidas, modelos (com análise da Meta) | ✅ |
| Campanhas | ✅ simulação; envio real com `WHATSAPP_CAMPAIGNS_LIVE=true` 🔒 |
| Anonimização LGPD | ✅ |
| Assistente de IA — nível 1 (sugestão revisada por humano) | ✅ pronto — falta a chave da Anthropic 🔒 ([IA.md](IA.md)) |

## Etapa A — Publicação no Render ✅
Publicado em `https://ponto-digital-crm.onrender.com` (ver [PUBLICACAO.md](PUBLICACAO.md)).

## Etapa B — Módulos completos no Supabase ✅ (Fase 2)

## Etapa C — WhatsApp oficial com coexistência (Fase 2: código pronto)
Ver [WHATSAPP_COEXISTENCIA.md](WHATSAPP_COEXISTENCIA.md): compatibilidade, caminhos de conexão, travas de teste/produção e as ações que dependem de você. 🔒

## Etapa D — Atendimento em equipe
Já existe: caixa de entrada por cliente, responsável, transferência, status, visão restrita para atendentes e **rodízio automático** de novos atendimentos. A acrescentar:
- Distribuição por serviço/interesse.
- Atualização em tempo real (Supabase Realtime) e aviso de nova mensagem.
- Indicadores por atendente (tempo de primeira resposta, conversas resolvidas).

## Etapa E — Agentes de IA para atendimento comercial
Nível 1 pronto (ver [IA.md](IA.md)). Os demais, com **controle humano**, ativados um a um:

| Nível | O que a IA faz | Controle |
| --- | --- | --- |
| 1. Sugestão | Escreve a resposta; o atendente revisa e envia | Nada sai sem clique humano |
| 2. Respostas simples | Responde sozinha a dúvidas frequentes (horário, serviços, portfólio) | Só dentro da janela de 24h, só contatos sem opt-out, regras e textos aprovados por você |
| 3. Apresentação comercial | Explica serviços e faz perguntas de qualificação; move o lead no funil | Passa para humano ao pedir preço fechado, reclamação ou qualquer dúvida fora do roteiro |
| 4. Link de pagamento | Prepara o link (Mercado Pago, Asaas ou Stripe) | **Sempre** com aprovação de um gestor/admin antes do envio; nunca coleta dados de cartão no chat |

Salvaguardas: base de conhecimento (serviços, preços, políticas) editável por você; toda mensagem da IA identificada e auditada; limite mensal de gasto; botão "pausar IA" por conversa e geral. Modelos sugeridos: Claude Haiku para triagem (mais econômico) e Claude Sonnet para respostas comerciais. Chave da API só no servidor. 🔒 (custo por uso da API)

## Ordem recomendada
A ✅ → B ✅ → C (conectar o número e testar com a equipe) → E nível 1 (ativar a IA) → D e níveis 2–4 da IA.
