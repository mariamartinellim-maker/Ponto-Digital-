# =============================================================================
#  Atualizador do Ponto Digital CRM (Windows)
#
#  Uso: dê dois cliques em ATUALIZAR-CRM.cmd (na pasta do CRM).
#
#  O que ele faz, nesta ordem:
#   1. Confere a pasta do CRM e se o CRM está fechado.
#   2. Faz um BACKUP completo (Desktop\Backups-Ponto-CRM\data-hora), incluindo
#      .env.local e .data.
#   3. Baixa a versão nova do GitHub (branch claude/ponto-digital-crm-xb5we9).
#   4. Copia os arquivos novos SEM tocar em .env.local, .env*, .data,
#      node_modules e .next — e confere por hash que eles não mudaram.
#   5. Instala as dependências (npm install) e limpa o cache (.next).
#   6. Oferece conectar o Supabase (npm run supabase:config) e iniciar o CRM.
#
#  Não altera configurações de segurança do Windows. Escrito para funcionar
#  também no modo restrito do PowerShell (Controle de Aplicativo).
# =============================================================================
param(
  [string]$Pasta = "",
  [string]$Zip = ""
)

$ErrorActionPreference = "Stop"
$Branch = "claude/ponto-digital-crm-xb5we9"
$UrlZip = "https://github.com/mariamartinellim-maker/Ponto-Digital-/archive/refs/heads/$Branch.zip"
# Arquivos de versões antigas que precisam sair (ex.: postcss.config.mjs fazia o
# Next.js carregar o Tailwind nativo, bloqueado pelo Controle de Aplicativo).
$Obsoletos = @("postcss.config.mjs", "postcss.config.js", "postcss.config.cjs")

function Titulo($texto) { Write-Host ""; Write-Host "== $texto ==" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "  [OK] $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "  [!] $texto" -ForegroundColor Yellow }
function Falha($texto) {
  Write-Host ""
  Write-Host "  [ERRO] $texto" -ForegroundColor Red
  if ($script:Backup) {
    Write-Host ""
    Write-Host "  Seu backup completo está em:" -ForegroundColor Yellow
    Write-Host "    $script:Backup" -ForegroundColor Yellow
    Write-Host "  Nada foi apagado. Para voltar exatamente como estava, rode no PowerShell:" -ForegroundColor Yellow
    Write-Host "    robocopy `"$script:Backup`" `"$script:Pasta`" /E" -ForegroundColor Yellow
  }
  exit 1
}
function Perguntar($texto) {
  $r = Read-Host "$texto (S/n)"
  return ($r -eq "" -or $r -match "^[sS]")
}
function EhPastaDoCrm($p) {
  if (-not $p) { return $false }
  $pkg = Join-Path $p "package.json"
  if (-not (Test-Path -LiteralPath $pkg)) { return $false }
  return ((Get-Content -LiteralPath $pkg -Raw) -match '"name"\s*:\s*"ponto-digital-crm"')
}
function HashArquivo($f) {
  # Get-FileHash; se o modo restrito do PowerShell bloquear, usa o certutil do Windows.
  try { return (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash } catch {
    $linhas = certutil -hashfile $f SHA256
    return ($linhas[1] -replace "\s", "").ToUpper()
  }
}
function Hashes($p) {
  # Impressão digital de .env.local e de todos os arquivos de .data
  $lista = @()
  $env1 = Join-Path $p ".env.local"
  if (Test-Path -LiteralPath $env1) { $lista += ".env.local=" + (HashArquivo $env1) }
  $dados = Join-Path $p ".data"
  if (Test-Path -LiteralPath $dados) {
    Get-ChildItem -LiteralPath $dados -Recurse -File | Sort-Object FullName | ForEach-Object {
      $lista += $_.FullName.Substring($p.Length) + "=" + (HashArquivo $_.FullName)
    }
  }
  return ($lista -join "`n")
}

Write-Host ""
Write-Host "  Ponto Digital CRM - Atualização segura" -ForegroundColor Magenta
Write-Host "  ---------------------------------------"

# -----------------------------------------------------------------------------
Titulo "1. Conferindo a instalação"
if (-not $Pasta) {
  $candidatas = @($PSScriptRoot, (Join-Path $env:USERPROFILE "Desktop\Ponto-Digital-CRM"), (Join-Path $env:USERPROFILE "OneDrive\Desktop\Ponto-Digital-CRM"), (Join-Path $env:USERPROFILE "OneDrive\Área de Trabalho\Ponto-Digital-CRM"))
  foreach ($c in $candidatas) { if (EhPastaDoCrm $c) { $Pasta = $c; break } }
}
if (-not (EhPastaDoCrm $Pasta)) {
  $Pasta = (Read-Host "Não encontrei a pasta do CRM. Cole o caminho dela (ex.: C:\Users\Cliente\Desktop\Ponto-Digital-CRM)").Trim('"', ' ')
  if (-not (EhPastaDoCrm $Pasta)) { Falha "A pasta '$Pasta' não parece ser o Ponto Digital CRM (package.json não encontrado)." }
}
$Pasta = (Resolve-Path -LiteralPath $Pasta).Path
$script:Pasta = $Pasta
Ok "Pasta do CRM: $Pasta"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Falha "Node.js/npm não encontrado. Instale o Node.js LTS em https://nodejs.org e rode novamente." }
Ok "Node.js encontrado: $(node --version)"

$temEnv = Test-Path -LiteralPath (Join-Path $Pasta ".env.local")
$temDados = Test-Path -LiteralPath (Join-Path $Pasta ".data")
if ($temEnv) { Ok ".env.local encontrado (será preservado)" } else { Aviso ".env.local não encontrado (depois rode: npm run setup)" }
if ($temDados) { Ok "Pasta .data encontrada (será preservada)" }

if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
  while (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    Aviso "O CRM parece estar aberto (porta 3000 em uso)."
    Read-Host "Feche a janela onde o CRM está rodando (ou aperte Ctrl+C nela) e pressione Enter aqui" | Out-Null
  }
}
Ok "CRM fechado"

# -----------------------------------------------------------------------------
Titulo "2. Backup completo"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$baseBackup = Join-Path $env:USERPROFILE "Desktop\Backups-Ponto-CRM"
$script:Backup = Join-Path $baseBackup $stamp
New-Item -ItemType Directory -Force -Path $script:Backup | Out-Null
robocopy $Pasta $script:Backup /E /XD node_modules .next /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Falha "Não foi possível criar o backup (robocopy código $LASTEXITCODE). Nada foi alterado." }
if ($temEnv -and -not (Test-Path -LiteralPath (Join-Path $script:Backup ".env.local"))) { Falha "O backup não contém o .env.local. Nada foi alterado." }
$global:LASTEXITCODE = 0
Ok "Backup salvo em: $script:Backup"
$hashAntes = Hashes $Pasta

# -----------------------------------------------------------------------------
Titulo "3. Baixando a versão nova"
$trabalho = Join-Path $env:TEMP "ponto-crm-atualizacao-$stamp"
New-Item -ItemType Directory -Force -Path $trabalho | Out-Null
$arquivoZip = Join-Path $trabalho "atualizacao.zip"

if ($Zip) {
  Copy-Item -LiteralPath $Zip -Destination $arquivoZip
} else {
  $baixou = $false
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    curl.exe -L -f -s -S --max-time 300 -o $arquivoZip $UrlZip
    $baixou = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $arquivoZip))
  }
  if (-not $baixou) {
    try { Invoke-WebRequest -Uri $UrlZip -OutFile $arquivoZip -UseBasicParsing; $baixou = $true } catch { $baixou = $false }
  }
  if (-not $baixou) {
    $downloads = Join-Path $env:USERPROFILE "Downloads"
    Aviso "Não consegui baixar automaticamente. Vou abrir o link no navegador."
    Start-Process $UrlZip
    Read-Host "Quando o download terminar (arquivo Ponto-Digital-...zip em Downloads), pressione Enter" | Out-Null
    $achado = Get-ChildItem -LiteralPath $downloads -Filter "Ponto-Digital-*.zip" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $achado) { Falha "Não encontrei o arquivo baixado em $downloads." }
    Copy-Item -LiteralPath $achado.FullName -Destination $arquivoZip
  }
}
Ok "Download concluído"

# tar.exe (nativo do Windows 10/11) funciona mesmo no modo restrito do PowerShell.
$destinoX = Join-Path $trabalho "x"
New-Item -ItemType Directory -Force -Path $destinoX | Out-Null
$extraiu = $false
if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
  tar.exe -xf $arquivoZip -C $destinoX
  $extraiu = ($LASTEXITCODE -eq 0)
}
if (-not $extraiu) {
  try { Expand-Archive -LiteralPath $arquivoZip -DestinationPath $destinoX -Force; $extraiu = $true } catch { $extraiu = $false }
}
if (-not $extraiu) { Falha "Não foi possível descompactar a atualização." }
$raiz = Get-ChildItem -LiteralPath (Join-Path $trabalho "x") -Directory | Select-Object -First 1
if (-not $raiz) { Falha "O arquivo baixado está vazio ou corrompido." }
$origem = Join-Path $raiz.FullName "Ponto-Digital-CRM"
if (-not (EhPastaDoCrm $origem)) { Falha "O arquivo baixado não contém o Ponto Digital CRM." }
if (-not (Test-Path -LiteralPath (Join-Path $origem "src\app\globals.css"))) { Falha "O arquivo baixado está incompleto." }
Ok "Versão nova conferida"

# -----------------------------------------------------------------------------
Titulo "4. Atualizando os arquivos (sem tocar em .env.local e .data)"
robocopy $origem $Pasta /E /XD node_modules .next .data /XF ".env*" "ATUALIZAR-CRM.cmd" /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Falha "Erro ao copiar os arquivos (robocopy código $LASTEXITCODE)." }
$global:LASTEXITCODE = 0
foreach ($o in $Obsoletos) {
  $alvo = Join-Path $Pasta $o
  if (Test-Path -LiteralPath $alvo) { Remove-Item -LiteralPath $alvo -Force; Ok "Removido arquivo antigo: $o" }
}
# .env.example é só um modelo (sem segredos): atualiza para documentar as novas variáveis.
Copy-Item -LiteralPath (Join-Path $origem ".env.example") -Destination (Join-Path $Pasta ".env.example") -Force

$hashDepois = Hashes $Pasta
if ($hashAntes -ne $hashDepois) { Falha ".env.local ou .data foram alterados inesperadamente." }
Ok "Arquivos atualizados"
Ok ".env.local e .data conferidos por hash: intactos"

# -----------------------------------------------------------------------------
Titulo "5. Instalando dependências (pode levar alguns minutos)"
Push-Location $Pasta
try {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Falha "npm install falhou (veja as mensagens acima)." }
  $next = Join-Path $Pasta ".next"
  if (Test-Path -LiteralPath $next) { Remove-Item -LiteralPath $next -Recurse -Force }
  Ok "Dependências instaladas e cache limpo"

  # ---------------------------------------------------------------------------
  Titulo "6. Supabase"
  $envTexto = ""
  if (Test-Path -LiteralPath ".env.local") { $envTexto = Get-Content -LiteralPath ".env.local" -Raw }
  $configurado = ($envTexto -match "(?m)^SUPABASE_URL=\S+") -and ($envTexto -match "(?m)^SUPABASE_PUBLISHABLE_KEY=\S+")
  if (-not (Test-Path -LiteralPath ".env.local")) {
    Aviso "Sem .env.local: rode 'npm run setup' e depois 'npm run supabase:config'."
  } elseif ($configurado) {
    Ok "Supabase já configurado neste computador."
    if ($envTexto -notmatch "(?m)^DATA_BACKEND=supabase") {
      if (Perguntar "O CRM está no modo demonstração. Ativar o Supabase agora?") { npm run modo:supabase }
    }
  } elseif (Perguntar "Conectar ao Supabase agora? Você vai colar a Project URL e a Publishable key") {
    Write-Host "  (No Supabase: Project Settings -> API Keys. NÃO use a Secret key.)" -ForegroundColor Gray
    npm run supabase:config
    if ($LASTEXITCODE -ne 0) { Aviso "Configuração não concluída. Você pode tentar de novo depois com: npm run supabase:config" }
  } else {
    Aviso "Quando quiser: npm run supabase:config"
  }

  Remove-Item -LiteralPath $trabalho -Recurse -Force -ErrorAction SilentlyContinue

  # ---------------------------------------------------------------------------
  Titulo "Pronto!"
  Ok "CRM atualizado. Backup em: $script:Backup"
  if (Perguntar "Iniciar o CRM agora?") {
    Write-Host ""
    Write-Host "  Abrindo http://localhost:3000 - se aparecer erro de conexão, aguarde ~30s e atualize (Ctrl+Shift+R)." -ForegroundColor Gray
    Write-Host "  Para encerrar o CRM: Ctrl+C nesta janela." -ForegroundColor Gray
    Start-Process "http://localhost:3000"
    npm run dev:webpack
  } else {
    Write-Host "  Para iniciar depois, na pasta do CRM: npm run dev:webpack" -ForegroundColor Gray
  }
} finally {
  Pop-Location
}
