# Backup manual do Supabase (plano gratuito)

O plano gratuito não guarda backups que você possa baixar. Este procedimento usa o `pg_dump`, a ferramenta
oficial e gratuita do PostgreSQL. Ele preserva **estrutura, dados, funções, políticas de segurança (RLS) e
permissões**. O backup só **lê** o banco e não altera nada.

## 1. Preparar o Windows (uma vez)

1. Instale as ferramentas do PostgreSQL 17, que são gratuitas. Use uma das duas opções:
   - No PowerShell: `winget install PostgreSQL.PostgreSQL.17`
   - Ou baixe o instalador em postgresql.org/download/windows e, na tela de componentes, marque só
     **Command Line Tools**.
2. Feche e abra o PowerShell de novo.

## 2. Dados de conexão (sem expor senha)

No painel do Supabase, clique em **Connect** e escolha **Session pooler**. Anote o **host**
(`aws-0-….pooler.supabase.com`) e o **usuário** (`postgres.<código do projeto>`).

A senha é a **senha do banco**. Se você não souber qual é, redefina em *Project Settings → Database → Reset
database password*. O CRM usa as chaves da API, não essa senha, então redefinir não afeta o sistema.

O script pede a senha na hora, sem mostrar na tela. Ela não é gravada em arquivo e é apagada da memória ao
final.

## 3. Gerar o backup

Na pasta `Ponto-Digital-CRM`, rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup\backup-supabase.ps1
```

O resultado fica em `Documentos\Backups-Supabase\<data_hora>`:

| Arquivo | Para que serve |
| --- | --- |
| `completo.dump` | Cópia integral do banco (arquivo de segurança). |
| `estrutura_e_dados.sql` | Tabelas, dados, funções, políticas e permissões do CRM, em texto legível. |
| `restaurar.sql` | O mesmo conteúdo, pronto para restaurar num projeto novo. |
| `usuarios_auth.sql` | Logins da equipe. |
| `inventario.txt` | Tabelas, quantidade de linhas e políticas no momento do backup. |
| `hashes.txt` | Impressão digital (SHA-256) de cada arquivo, para provar que não foram alterados. |

**Confira** se o script terminou com "Backup concluído" e se `inventario.txt` mostra o cliente de teste
(1 linha em `public.clients`). Se aparecer qualquer erro, o backup **não** vale.

**Guarde em local seguro**, como um pendrive ou uma nuvem pessoal com senha. Os arquivos têm dados de
clientes e senhas criptografadas da equipe. Nunca envie esses arquivos ao GitHub nem por chat.

## 4. Restaurar, se necessário

**A. Só desfazer a migração das seis tabelas (caso mais provável).** Não é preciso restaurar o backup. No
*SQL Editor* do Supabase, rode `supabase/scripts/reverter-operacao.sql`. Ele remove apenas as seis tabelas
novas, e só se estiverem vazias. As demais tabelas não são tocadas.

**B. Perda de dados (recuperação completa).** A restauração é feita num projeto Supabase **novo**, porque o
gratuito permite dois projetos. Isso evita sobrescrever o atual.

1. Crie um projeto novo no Supabase.
2. Rode o script de restauração. Ele confere os hashes, recusa um destino que já tenha as tabelas do CRM,
   pede para você digitar RESTAURAR e grava tudo numa transação única:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\backup\restaurar-supabase.ps1
   ```
3. Compare os números exibidos com os de `inventario.txt`.
4. No Render, troque `SUPABASE_URL` e as chaves pelas do projeto novo.
5. Refaça no painel as configurações que não ficam no banco: *Authentication → URL Configuration* e e-mail
   (SMTP).

## O que este backup não cobre

- **Arquivos do Storage**: o bucket `crm-arquivos` ainda não existe. Ele passa a ser usado só depois da
  biblioteca e dos comprovantes.
- **Configurações do painel**, como URLs de autenticação, SMTP e chaves da API. Anote essas configurações
  separadamente.
