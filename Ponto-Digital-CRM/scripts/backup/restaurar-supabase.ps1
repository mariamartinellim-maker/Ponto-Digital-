<#
  RESTAURA um backup gerado por backup-supabase.ps1 num projeto Supabase NOVO e VAZIO.
  Recusa continuar se o banco de destino já tiver as tabelas do CRM (não sobrescreve dados).
  Para apenas desfazer a migração operacional, use supabase/scripts/reverter-operacao.sql.

  Uso (PowerShell):  powershell -ExecutionPolicy Bypass -File .\scripts\backup\restaurar-supabase.ps1
#>
$ErrorActionPreference = "Stop"
function Find-PgTool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$name.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { return $found.FullName }
  throw "Não encontrei $name. Instale as ferramentas de linha de comando do PostgreSQL 17."
}
$psql = Find-PgTool "psql"

Write-Host "`nRestauração de backup do Supabase (somente para projeto NOVO e vazio)`n" -ForegroundColor Yellow
$dir = Read-Host "Pasta do backup (ex.: C:\Users\voce\Documents\Backups-Supabase\2026-10-26_09-30)"
foreach ($f in "restaurar.sql", "usuarios_auth.sql", "hashes.txt") {
  if (-not (Test-Path (Join-Path $dir $f))) { throw "Arquivo $f não encontrado na pasta." }
}
# Integridade: os arquivos não podem ter sido alterados desde o backup
foreach ($line in Get-Content (Join-Path $dir "hashes.txt")) {
  $hash, $name = $line -split '\s+', 2
  if ($name -and (Test-Path (Join-Path $dir $name)) -and (Get-FileHash (Join-Path $dir $name) -Algorithm SHA256).Hash -ne $hash) {
    throw "O arquivo $name foi alterado depois do backup. Restauração cancelada."
  }
}
$pgHost = Read-Host "Host do projeto DE DESTINO (Session pooler)"
$pgUser = Read-Host "Usuário do projeto DE DESTINO"
$secure = Read-Host "Senha do banco DE DESTINO" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:PGSSLMODE = "require"
  $env:PGCLIENTENCODING = "UTF8"
  $conn = @("-h", $pgHost, "-p", "5432", "-U", $pgUser, "-d", "postgres")
  $exists = (& $psql @conn -At -c "select to_regclass('public.clients') is not null or to_regnamespace('app') is not null").Trim()
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível conectar ao destino." }
  if ($exists -eq "t") { throw "O destino já tem as tabelas do CRM. Restauração cancelada para não sobrescrever dados." }
  $confirm = Read-Host "Digite RESTAURAR para gravar o backup em $pgHost"
  if ($confirm -cne "RESTAURAR") { throw "Cancelado." }

  & $psql @conn -v ON_ERROR_STOP=1 -q -f (Join-Path $dir "usuarios_auth.sql")
  if ($LASTEXITCODE -ne 0) { throw "Falha ao restaurar os logins (auth). Nada do CRM foi gravado ainda." }
  & $psql @conn -v ON_ERROR_STOP=1 -q -1 -f (Join-Path $dir "restaurar.sql")
  if ($LASTEXITCODE -ne 0) { throw "Falha ao restaurar o CRM. A transação foi desfeita (as tabelas do CRM não foram criadas)." }

  & $psql @conn -At -c "select 'tabelas: ' || count(*) from pg_tables where schemaname = 'public' union all select 'politicas: ' || count(*) from pg_policies where schemaname = 'public' union all select 'clientes: ' || count(*) from public.clients"
  Write-Host "`nRestauração concluída. Compare os números acima com inventario.txt do backup." -ForegroundColor Green
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
