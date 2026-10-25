# Publicação do CRM

O CRM publicado usa o **mesmo Supabase** que você já usa no computador. O CRM local continua funcionando igual (modo e dados não mudam).

## Qual hospedagem (comparação de custos — outubro/2026)

| Opção | Custo mensal | Uso comercial | Sempre ligado (webhooks) | HTTPS | Facilidade |
| --- | --- | --- | --- | --- | --- |
| **Render Starter** ✅ recomendado | **US$ 7** (≈ R$ 40) por serviço; conta (Hobby) gratuita | Sim | Sim | Automático | Alta: conecta ao GitHub e lê o `render.yaml` |
| Railway Hobby | US$ 5 com US$ 5 de uso incluso; acima disso, cobrança por consumo (≈ US$ 5–10) | Sim | Sim | Automático | Alta, mas o valor varia mês a mês |
| Fly.io (São Paulo) | ≈ US$ 6 por consumo (512 MB) | Sim | Sim | Automático | Baixa: exige linha de comando e Dockerfile |
| Vercel Pro | US$ 20 **por membro** | Sim | Sim | Automático | Alta |
| Vercel Hobby / Render Free | US$ 0 | **Não** (Vercel) / dorme após 15 min (Render) | Não | Sim | — |

**Por que Render Starter:** preço fixo e previsível, permitido para uso comercial, sempre ligado (a Meta exige que o webhook do WhatsApp responda a qualquer hora), HTTPS e renovação de certificado automáticos, publicação a cada atualização da `main`, e funciona com Next.js 16 sem adaptações. Testado aqui com o mesmo comando de produção do Render: **207 MB de memória** em uso (limite do plano: 512 MB) e **34 de 34 cenários** aprovados.

Observação: o Render não tem servidores na América do Sul; a região mais próxima é **Virginia (EUA)**. A diferença de tempo de resposta é pequena para um CRM. Se quiser servidor em São Paulo no futuro, o Fly.io é a alternativa (mais técnico).

## O que já está preparado no código

| Proteção | Como funciona |
| --- | --- |
| Nunca publica em modo demonstração | No Render (ou com `CRM_PUBLICADO=true`, ou na Vercel) o CRM se recusa a iniciar sem `DATA_BACKEND=supabase`. |
| Só HTTPS | Publicado, `APP_URL` precisa começar com `https://`; HSTS força HTTPS no navegador. |
| Sem chave secreta | O CRM recusa iniciar se a chave secreta do Supabase for usada no lugar da publicável. |
| Senhas | Ficam só no Supabase Auth (com recuperação por e-mail). Nenhuma senha vai para a hospedagem. |
| Dados | Protegidos pelo RLS do banco: mesmo com a URL e a chave publicável, um visitante não lê nada (verificado por `npm run verificar:publicacao`). |
| WhatsApp | Publicado com `WHATSAPP_SEND_MODE=simulacao` e campanhas desligadas: nada é enviado. |
| Buscadores | Páginas marcadas como `noindex`. |
| Cabeçalhos | CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy. |

## Passo a passo no Render (você clica; o resto já está pronto)

### 1. Aprovar o Pull Request
O Render publica a branch `main`. O Pull Request adiciona a pasta `Ponto-Digital-CRM` e o arquivo `render.yaml` à `main`. O sistema antigo (Flask), na raiz, **não é alterado nem publicado**. Revise e clique em **Merge** no GitHub.

### 2. Gerar os valores das variáveis
No seu computador, na pasta do CRM:
```powershell
npm run publicacao:env
```
Deixe a janela aberta: você vai copiar `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` (é a chave **publicável**; a secreta nunca é usada).

### 3. Criar o serviço no Render 🔒 (gera cobrança de US$ 7/mês)
1. Acesse https://render.com e entre com **GitHub**. Ative a verificação em duas etapas (*Account Settings*).
2. **New → Blueprint** → autorize o Render a ver o repositório `Ponto-Digital-` → selecione-o.
3. O Render lê o `render.yaml` e mostra o serviço **ponto-digital-crm** no plano **Starter** (código `0.5c-512mb`: 0,5 CPU e 512 MB). Ele pede 3 valores:
   - `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`: cole do passo 2;
   - `APP_URL`: `https://ponto-digital-crm.onrender.com`.
4. Cadastre o cartão quando pedido e clique em **Deploy Blueprint**. A primeira publicação leva uns 5 minutos.
5. Confira o endereço mostrado no topo do serviço. Se for diferente de `https://ponto-digital-crm.onrender.com` (quando o nome já existe, o Render acrescenta letras), atualize `APP_URL` em **Environment** com o endereço exato e salve (o Render republica sozinho).

> Alternativa sem Blueprint: **New → Web Service**, repositório `Ponto-Digital-`, *Root Directory* `Ponto-Digital-CRM`, *Build Command* `npm ci --include=dev && npm run build`, *Start Command* `npm start`, plano **Starter**, e em **Environment → Add from .env** cole o bloco do `npm run publicacao:env` (troque o APP_URL e acrescente `NODE_VERSION=22`).

### 4. Ajustar o Supabase para o endereço publicado
Em **Authentication → URL Configuration**:
- **Site URL**: o endereço do Render (ex.: `https://ponto-digital-crm.onrender.com`).
- **Redirect URLs**: adicione `https://ponto-digital-crm.onrender.com/**` (mantenha `http://localhost:3000/**` para o CRM local).

### 5. Conferir a segurança do endereço publicado
No seu computador, na pasta do CRM:
```powershell
npm run verificar:publicacao -- https://ponto-digital-crm.onrender.com
```
Tudo deve aparecer com ✔. Depois, entre com seu e-mail e senha pelo navegador de qualquer computador ou celular.

## Outras hospedagens
- **Vercel:** importe o repositório com *Root Directory* `Ponto-Digital-CRM` e cole o bloco do `npm run publicacao:env` em *Environment Variables*. Para uso comercial exige o plano Pro.
- **Qualquer outra (Railway, Fly.io…):** Node.js 22, `npm ci --include=dev && npm run build`, `npm start`, pasta `Ponto-Digital-CRM` e as mesmas variáveis (incluindo `CRM_PUBLICADO=true`).

## Recomendações de segurança (sem custo)
- Ative a **verificação em duas etapas** nas contas do GitHub, Render e Supabase.
- No Supabase, mantenha o **cadastro público desativado** (o verificador confere).
- Use senhas longas e únicas para cada pessoa da equipe; nunca compartilhe logins.
- Domínio próprio (ex.: `crm.pontodigital.com.br`) pode ser ligado depois em *Render → Settings → Custom Domains* (sem custo extra; atualize `APP_URL` e as URLs do Supabase).
