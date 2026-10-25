# Publicação na Vercel

O CRM publicado usa o **mesmo Supabase** que você já usa no computador. O CRM local continua funcionando igual.

## O que já está preparado no código

| Proteção | Como funciona |
| --- | --- |
| Nunca publica em modo demonstração | Na Vercel, o CRM se recusa a iniciar sem `DATA_BACKEND=supabase`. |
| Só HTTPS | Na Vercel, `APP_URL` precisa começar com `https://`; HSTS força HTTPS no navegador. |
| Sem chave secreta | O CRM recusa iniciar se a chave secreta do Supabase for usada no lugar da publicável. |
| Senhas | Ficam só no Supabase Auth (com recuperação por e-mail). Nenhuma senha vai para a Vercel. |
| Dados | Protegidos pelo RLS do banco: mesmo com a URL e a chave publicável, um visitante não lê nada (verificado por `npm run verificar:publicacao`). |
| Buscadores | Páginas marcadas como `noindex`. |
| Cabeçalhos | CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy. |

## Passo a passo (você clica; o resto já está pronto)

### 1. Levar o CRM para a branch principal (autorização)
A Vercel publica a branch `main`. Hoje o CRM está na branch `claude/ponto-digital-crm-xb5we9`. Com sua autorização, abro um *Pull Request* que adiciona a pasta `Ponto-Digital-CRM` à `main` — o sistema antigo (Flask), que fica na raiz, **não é alterado**.

### 2. Criar o projeto na Vercel
1. Acesse https://vercel.com e entre com **Continue with GitHub**.
2. **Add New… → Project → Import** o repositório `Ponto-Digital-`.
3. Em **Root Directory**, clique em *Edit* e escolha **`Ponto-Digital-CRM`**.
4. *Framework Preset*: **Next.js** (detectado automaticamente). Não altere os comandos de build.
5. Abra **Environment Variables**. No seu computador, na pasta do CRM, rode:
   ```powershell
   npm run vercel:env
   ```
   Copie o bloco entre as linhas `-----8<-----` e **cole no campo "Key"** da Vercel (ela separa as variáveis sozinha).
6. Clique em **Deploy**. Ao terminar, a Vercel mostra o endereço (ex.: `https://ponto-digital-crm.vercel.app`).
7. Em **Settings → Environment Variables**, edite `APP_URL` com esse endereço e clique em **Redeploy** (menu *Deployments*).

> **Plano da Vercel:** o plano gratuito (Hobby) é para uso pessoal e não comercial, segundo os termos da Vercel. Para o CRM da agência, o adequado é o plano **Pro** (cobrança mensal por membro). Peço sua autorização antes de qualquer etapa que gere cobrança.

### 3. Ajustar o Supabase para o endereço publicado
Em **Authentication → URL Configuration**:
- **Site URL**: o endereço da Vercel (ex.: `https://ponto-digital-crm.vercel.app`).
- **Redirect URLs**: adicione `https://ponto-digital-crm.vercel.app/**` (mantenha `http://localhost:3000/**` para o CRM local).

### 4. Conferir a segurança do endereço publicado
No seu computador, na pasta do CRM:
```powershell
npm run verificar:publicacao -- https://ponto-digital-crm.vercel.app
```
Tudo deve aparecer com ✔. Depois, entre com seu e-mail e senha pelo navegador de qualquer computador.

## Recomendações de segurança (sem custo)
- Ative a **verificação em duas etapas** nas contas do GitHub, Vercel e Supabase.
- No Supabase, mantenha o **cadastro público desativado** (o verificador confere).
- Use senhas longas e únicas para cada pessoa da equipe; nunca compartilhe logins.
- Domínio próprio (ex.: `crm.pontodigital.com.br`) pode ser ligado depois em *Vercel → Settings → Domains*.
