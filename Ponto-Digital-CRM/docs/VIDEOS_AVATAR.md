# Vídeos com avatar e atendimento automático

## Fluxo
1. Contato novo vindo de anúncio → "Oieh, boa noite! Tudo bem?" + "Seu contato seria sobre o vídeo de Uber ou de táxi?" (ou o áudio gravado).
2. Cliente responde a modalidade → pede a foto e as informações (nome, cidade, WhatsApp) (ou o áudio gravado).
3. Foto + informações → a IA (Claude) escreve um **roteiro curto** e envia para o cliente aprovar. Se ele mandou mais do que cabe, o robô enxuga e explica.
4. "pode continuar" → avatar (OpenAI) → enviado para aprovar. Ajuste → refaz com o ajuste.
5. "pode continuar" → vídeo (Veo, 8 s de fala + 2 s de logo final) → prévia com marca d'água + valor e chave Pix.
6. Comprovante (imagem reconhecida pela IA como comprovante) → vídeo final sem marca → etiqueta "cliente finalizado".

Fora do roteiro (3 respostas não entendidas, falha, limite de gasto, ajuste de roteiro sem IA) → "Só um instante que já te respondo" e a conversa passa para a equipe (tela **Vídeos com avatar** → "Atendimento automático").

## Para ligar (nesta ordem)
1. Banco: rodar `supabase/migrations/20261028000000_videos_avatar.sql` no SQL Editor (idempotente, só cria tabelas novas).
2. Tela **Vídeos com avatar** → "Configurar o robô": valor, chave Pix, (opcional) áudios da biblioteca, marcar "Ligar". Comece com "Só números de teste".
3. Sem as chaves pagas, o robô roda no **simulador** (avatar = foto, vídeo = foto animada) — serve para testar o atendimento sem gastar.
4. IA paga (só com ok e limite de gasto), nas variáveis do Render:
   - `VIDEO_AUTOMACAO=true`
   - `OPENAI_API_KEY` (avatar) e `GOOGLE_AI_API_KEY` (Veo)
   - `VIDEO_LIMITE_MES` (padrão 20 gerações por mês; cada avatar ou vídeo conta 1)
   - `ANTHROPIC_API_KEY` (já usada no CRM): roteiro, entender respostas e ler comprovantes.

## Travas
- Robô desligado por padrão e, ao ligar, "só números de teste" vem marcado.
- Envios passam pelas travas do WhatsApp (`WHATSAPP_SEND_MODE`, `WHATSAPP_AMBIENTE=teste`, `WHATSAPP_NUMEROS_TESTE`).
- Cada pedido refaz avatar/vídeo no máximo `VIDEO_MAX_REFACOES` vezes (padrão 3).
