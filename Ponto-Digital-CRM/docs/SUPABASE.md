# Banco de dados no Supabase — passo a passo

Arquivo: `supabase/migrations/20261024000000_inicial.sql` (PostgreSQL 15 ou superior — padrão dos projetos Supabase).

> Execute em um **projeto novo e vazio**. O script não apaga nada, mas foi feito para a primeira instalação.
> O CRM continua em modo demonstração até a etapa de conexão (`DATA_BACKEND=supabase`); executar o SQL não altera o app.

## 1. Antes de executar

1. Crie o projeto no Supabase, de preferência na região **São Paulo (sa-east-1)** (LGPD e menor latência). Guarde a senha do banco num gerenciador de senhas.
2. **Authentication → Sign In / Providers → Email**: desative **"Allow new users to sign up"**. Usuários são criados só pela administração. (Mesmo que alguém consiga se cadastrar, o banco não mostra nada a quem não tem perfil — está testado.)
3. **Authentication → Users → Add user → Create new user**: crie o seu acesso de administrador, com senha forte e **Auto Confirm User** marcado.

## 2. Executar o esquema

1. **SQL Editor → New query**.
2. Cole todo o conteúdo de `supabase/migrations/20261024000000_inicial.sql` e clique em **Run**.
3. Deve terminar com "Success. No rows returned".

## 3. Criar a organização e o administrador

No **SQL Editor**, troque o e-mail e o nome e execute:

```sql
select app.bootstrap_first_admin('seu-email@dominio.com', 'Ponto Digital', 'Seu Nome');
```

- Funciona **uma única vez** (recusa se já houver organização).
- Só roda pelo SQL Editor; usuários do app e a chave de serviço não conseguem chamá-la.
- O restante da equipe é adicionado depois, pela tela **Equipe e permissões** do CRM.

## 4. Conferir

```sql
select o.name, p.name, p.email, p.role from public.organizations o join public.profiles p on p.org_id = o.id;
```

Deve mostrar uma linha: Ponto Digital · seu nome · seu e-mail · admin.

## 5. Conectar o CRM ao Supabase (Windows)

O CRM usa apenas a **URL do projeto** e a **chave publicável** (`sb_publishable_...` ou a antiga `anon`). A chave **secreta** (`sb_secret_...` / `service_role`) **não é usada** — se for colada por engano, o CRM recusa.

1. **Liberar o endereço de retorno da recuperação de senha** — no Supabase: *Authentication → URL Configuration*:
   - *Site URL*: `http://localhost:3000`
   - *Redirect URLs* → *Add URL*: `http://localhost:3000/**`
2. **Copiar a URL e a chave publicável** — *Project Settings → API Keys* (ou *Data API*): copie a *Project URL* e a *Publishable key*.
3. **Rodar o assistente** — no PowerShell, dentro da pasta `Ponto-Digital-CRM`:
   ```powershell
   npm run supabase:config
   ```
   Cole a URL, pressione Enter, cole a chave e pressione Enter. O assistente testa a conexão, guarda um backup do `.env.local` e ativa o modo Supabase. Nenhuma outra configuração (senhas, segredos) é alterada.
4. **Iniciar o CRM** — `npm run dev:webpack` e entre com o **e-mail e a senha do seu usuário do Supabase**.

Para voltar aos dados demonstrativos locais (nada é apagado): `npm run modo:demo`. Para voltar ao Supabase: `npm run modo:supabase`. Sempre reinicie o CRM depois de trocar.

### O que já funciona com o Supabase

| Módulo | Situação |
| --- | --- |
| Login, sair, recuperação de senha (e-mail enviado pelo Supabase) | ✅ |
| Dashboard | ✅ leitura |
| Clientes: cadastro, edição, consentimento, importação CSV, exportação LGPD | ✅ |
| Funil comercial: mover etapas, nova oportunidade | ✅ |
| Atendimento: conversas, envio (simulado), respostas rápidas, responsável, resolver | ✅ |
| Agenda, Campanhas, Modelos, Equipe | 👁️ somente leitura (gravação na próxima etapa) |
| Anonimização LGPD e mensagens recebidas do WhatsApp | próxima etapa (exigem função segura no servidor) |

Novos usuários da equipe, por enquanto: *Authentication → Users → Add user* e, no SQL Editor,
`insert into public.profiles (id, org_id, name, email, role) select u.id, p.org_id, 'Nome', u.email, 'atendente' from auth.users u, public.profiles p where u.email = 'pessoa@dominio.com' and p.email = 'seu-email@dominio.com';`

## O que o esquema garante (testado em `supabase/tests/rls-test.sql` — 58 verificações)

| Tema | Garantia |
| --- | --- |
| Isolamento | Cada usuário só vê a própria organização. Chaves estrangeiras compostas impedem ligar registros de organizações diferentes, mesmo sabendo o ID. |
| Privilégios | O padrão do Supabase (liberar tudo para `anon`/`authenticated`) é revogado; cada tabela recebe só as colunas necessárias. `anon` não acessa nada. |
| Perfis | Só admin cria, altera ou remove usuários, e apenas na própria organização. A organização nunca fica sem administrador ativo. Ninguém se promove. |
| Auditoria | Cada usuário registra apenas as próprias ações, sem escolher data/hora nem IP. Só admin lê. Ninguém altera ou apaga — nem o servidor. |
| Consentimento | O status do cliente muda **somente** por um registro no histórico, sempre em nome de quem está logado. O histórico é permanente (anonimização LGPD preserva a prova). |
| Campanhas | O banco recusa destinatário sem opt-in. Modo de envio real só pelo servidor. |
| Modelos | Criados como "pendente"; aprovação só pelo servidor (vinda da Meta). |
| Mensagens | Usuários só gravam mensagens enviadas em seu nome; mensagens recebidas chegam pelo webhook. Webhooks repetidos são ignorados. |
| Clientes | Não podem ser excluídos pela API; a eliminação LGPD é feita por anonimização. |

## Futuras alterações no banco

Toda tabela nova criada em `public` recebe do Supabase acesso total para `anon` e `authenticated`. Cada nova migração deve **revogar** esse acesso, conceder só o necessário, ativar RLS e ser incluída no teste `supabase/tests/rls-test.sql`.

Para rodar o teste num PostgreSQL local (nunca no Supabase):

```bash
createdb pdcrm_test && psql -d pdcrm_test -f supabase/tests/rls-test.sql
```
