<#
  Backup manual GRATUITO do banco Supabase (plano free, sem backups automáticos).
  Gera, numa pasta com data e hora:
    completo.dump          cópia integral em formato do PostgreSQL (arquivo de segurança)
    estrutura_e_dados.sql  esquemas public e app: tabelas, dados, funções, políticas RLS e permissões
    restaurar.sql          o mesmo arquivo, pronto para restaurar num projeto Supabase novo
    usuarios_auth.sql      logins da equipe (auth.users e auth.identities)
    inventario.txt         tabelas, linhas e políticas no momento do backup (para conferência)
    conteudo_dump.txt      lista de objetos do completo.dump
    hashes.txt             SHA-256 de cada arquivo (prova de integridade)

  Somente LEITURA no banco: usa pg_dump/psql com consultas SELECT. Não altera nada.
  A senha é pedida na hora, fica só na memória deste processo e é apagada no final.

  Requisito: ferramentas de linha de comando do PostgreSQL 17 (gratuitas).
  Uso (PowerShell):  powershell -ExecutionPolicy Bypass -File .\scripts\backup\backup-supabase.ps1
#>
$ErrorActionPreference = "Stop"

function Find-PgTool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$name.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { return $found.FullName }
  throw "Não encontrei $name. Instale as ferramentas de linha de comando do PostgreSQL 17 (veja docs/BACKUP_SUPABASE.md)."
}
function Run([string]$exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($exe)) terminou com erro ($LASTEXITCODE). O backup NÃO está completo." }
}

$pgDump = Find-PgTool "pg_dump"
$pgRestore = Find-PgTool "pg_restore"
$psql = Find-PgTool "psql"

Write-Host "`nBackup manual do Supabase (somente leitura)`n" -ForegroundColor Cyan
Write-Host "No painel do Supabase: botão Connect > Session pooler. Copie host e usuário (sem a senha)."
$pgHost = Read-Host "Host (ex.: aws-0-sa-east-1.pooler.supabase.com)"
$pgUser = Read-Host "Usuário (ex.: postgres.abcdefghijklmnop)"
$secure = Read-Host "Senha do banco (não aparece na tela)" -AsSecureString

$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$out = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Backups-Supabase\$stamp"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:PGSSLMODE = "require"
  $env:PGCLIENTENCODING = "UTF8"
  $conn = @("-h", $pgHost, "-p", "5432", "-U", $pgUser, "-d", "postgres")

  # 1. Versões: o pg_dump precisa ser da mesma versão do servidor ou mais novo.
  $server = (& $psql @conn -At -c "show server_version_num").Trim()
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível conectar. Confira host, usuário e senha." }
  $client = ((& $pgDump --version) -replace '[^\d.]', '' -split '\.')[0]
  if ([int]$client -lt [int]($server.Substring(0, 2))) { throw "pg_dump $client é mais antigo que o servidor ($server). Instale o PostgreSQL 17." }
  Write-Host "Conectado. Servidor PostgreSQL $server, pg_dump $client."

  # 2. Inventário (para conferir depois de uma restauração)
  $inv = @"
select 'tabela' as tipo, n.nspname || '.' || c.relname as nome, c.reltuples::bigint as linhas_aprox, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public', 'app')
union all
select 'politica', schemaname || '.' || tablename || ' > ' || policyname, null, null from pg_policies where schemaname in ('public', 'app')
union all
select 'usuarios_auth', 'auth.users', (select count(*) from auth.users), null
order by 1, 2;
"@
  Run $psql ($conn + @("-A", "-F", " | ", "-c", $inv, "-o", (Join-Path $out "inventario.txt")))

  # 3. Cópia integral (formato custom do PostgreSQL)
  Write-Host "Gerando cópia integral..."
  Run $pgDump ($conn + @("-Fc", "-f", (Join-Path $out "completo.dump")))

  # 4. Esquemas do CRM em SQL legível (estrutura + dados + funções + políticas + permissões)
  Write-Host "Gerando estrutura_e_dados.sql..."
  Run $pgDump ($conn + @("-n", "public", "-n", "app", "--no-owner", "-f", (Join-Path $out "estrutura_e_dados.sql")))

  # 5. Versão para restaurar num projeto novo (o esquema public já existe no Supabase)
  $sql = [IO.File]::ReadAllText((Join-Path $out "estrutura_e_dados.sql"), [Text.Encoding]::UTF8)
  $sql = $sql -replace '(?m)^CREATE SCHEMA public;\r?$', '-- CREATE SCHEMA public; (já existe no Supabase)'
  $sql = $sql -replace '(?m)^COMMENT ON SCHEMA public IS .*$', '-- (comentário do esquema public omitido)'
  [IO.File]::WriteAllText((Join-Path $out "restaurar.sql"), $sql, (New-Object Text.UTF8Encoding($false)))

  # 6. Logins da equipe (necessários para os perfis em public.profiles)
  Write-Host "Gerando usuarios_auth.sql..."
  Run $pgDump ($conn + @("--data-only", "-t", "auth.users", "-t", "auth.identities", "-f", (Join-Path $out "usuarios_auth.sql")))

  # 7. Conferência: o arquivo integral pode ser lido e contém as políticas
  & $pgRestore -l (Join-Path $out "completo.dump") | Out-File -Encoding utf8 (Join-Path $out "conteudo_dump.txt")
  if ($LASTEXITCODE -ne 0) { throw "O arquivo completo.dump não pôde ser lido. Gere o backup de novo." }
  $policies = (Select-String -Path (Join-Path $out "conteudo_dump.txt") -Pattern " POLICY " | Measure-Object).Count
  $tables = (Select-String -Path (Join-Path $out "conteudo_dump.txt") -Pattern " TABLE public " | Measure-Object).Count

  Get-ChildItem $out -File | Where-Object Name -ne "hashes.txt" | Get-FileHash -Algorithm SHA256 |
    ForEach-Object { "{0}  {1}" -f $_.Hash, (Split-Path $_.Path -Leaf) } | Out-File -Encoding utf8 (Join-Path $out "hashes.txt")

  Write-Host "`nBackup concluído em: $out" -ForegroundColor Green
  Write-Host "Tabelas em public: $tables  |  Políticas de segurança: $policies"
  Write-Host "ATENÇÃO: os arquivos contêm dados de clientes e senhas criptografadas da equipe."
  Write-Host "Guarde em local seguro (ex.: pendrive ou nuvem pessoal com senha). Nunca envie ao GitHub nem por chat."
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
