# Run only after reading docs/CONFIG-AUDIT.md.
# Installs Concord into .sandbox-tools, not the user's global npm prefix.
# Registers project-level Claude MCP and an isolated Codex config.
# HOME/USERPROFILE are redirected to .sandbox-home for the WHOLE run (install,
# setup, status) and for the registered MCP servers at runtime.
[CmdletBinding()]
param(
  # Exact Concord version to install (v0.20.0 = latest GitHub release / npm
  # version checked on 2026-11-06). Override with -ConcordVersion x.y.z.
  [string]$ConcordVersion = '0.20.0'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolRoot = Join-Path $repo '.sandbox-tools'
$codexHome = Join-Path $repo '.sandbox-codex'
$homeSandbox = Join-Path $repo '.sandbox-home'
$mcpJsonPath = Join-Path $repo '.mcp.json'
$codexConfigPath = Join-Path $codexHome 'config.toml'
$package = '@concord-ai/concord-mcp'

Write-Host '=== Concord MCP isolated setup ==='
Write-Host "Project: $repo"
Write-Host 'Intended writes: .sandbox-tools/, .sandbox-home/, .sandbox-codex/config.toml, .mcp.json, .concord/ and repository instructions (CLAUDE.md / AGENTS.md; existing ones are backed up).'
Write-Host "'concord setup' is run with --no-global --no-adapters --no-mcp. This does not enable native live-delivery adapters."
if (Test-Path $mcpJsonPath) { throw '.mcp.json already exists; review it and merge Concord registration manually.' }
if (Test-Path $codexConfigPath) { throw 'Sandbox Codex config already exists; review it before proceeding.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js/npm not found; install Node.js >= 20 first.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node not found; install Node.js >= 20 first.' }
$nodeMajor = [int](((& node --version) -replace '^v', '').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node.js >= 20 required (found $nodeMajor)." }

# Back up existing instruction files that 'concord setup' may modify.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($name in 'CLAUDE.md', 'AGENTS.md') {
  $p = Join-Path $repo $name
  if (Test-Path $p) { Copy-Item $p "$p.bak-$stamp"; Write-Host "Backed up $name -> $name.bak-$stamp" }
}

$env:CONCORD_TELEMETRY_DISABLED = '1'
$env:CONCORD_NO_UPDATE_CHECK = '1'
$env:CONCORD_ALLOWED_ROOTS = $repo
$env:CONCORD_REPO_ROOT = $repo
$env:CODEX_HOME = $codexHome

# Isolate HOME/USERPROFILE for the entire run, including npm lifecycle scripts,
# so no home-scoped Concord/npm file is read or written outside this project.
New-Item -ItemType Directory -Path $homeSandbox -Force | Out-Null
New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
$npmCache = Join-Path $toolRoot '.npm-cache'
$npmUserConfig = Join-Path $homeSandbox '.npmrc'
$oldHome = $env:HOME
$oldUserProfile = $env:USERPROFILE
try {
  $env:HOME = $homeSandbox
  $env:USERPROFILE = $homeSandbox

  if ($ConcordVersion -notmatch '^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$') { throw "ConcordVersion must be an exact version (got '$ConcordVersion')." }

  Write-Host "[1/4] Installing $package@$ConcordVersion into project-local tools directory (lifecycle scripts disabled)..."
  & npm.cmd install --prefix $toolRoot --no-save --ignore-scripts --no-audit --no-fund --cache $npmCache --userconfig $npmUserConfig "$package@$ConcordVersion"
  if ($LASTEXITCODE -ne 0) { throw 'npm installation failed.' }
  $binPath = Join-Path $toolRoot 'node_modules\.bin'
  $concord = Join-Path $binPath 'concord.cmd'
  $mcp = Join-Path $binPath 'concord-mcp.cmd'
  if (-not (Test-Path $concord) -or -not (Test-Path $mcp)) { throw 'Concord CLI shims not found.' }

  Write-Host '[2/4] Creating repository workspace and instructions only...'
  & $concord setup --no-global --no-adapters --no-mcp
  if ($LASTEXITCODE -ne 0) { throw 'Concord setup failed; inspect generated files before retrying.' }

  Write-Host '[3/4] Registering project-only Claude MCP and isolated Codex MCP...'
  # Claude Code reads the .mcp.json in this project directory.
  # HOME/USERPROFILE are set so the MCP server also stays inside the sandbox at runtime.
  $serverEnv = [ordered]@{
    CONCORD_REPO_ROOT          = $repo
    CONCORD_TELEMETRY_DISABLED = '1'
    CONCORD_NO_UPDATE_CHECK    = '1'
    CONCORD_ALLOWED_ROOTS      = $repo
    HOME                       = $homeSandbox
    USERPROFILE                = $homeSandbox
  }
  $mcpJson = @{ mcpServers = @{ concord = @{ command = $mcp; env = $serverEnv } } } | ConvertTo-Json -Depth 5
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($mcpJsonPath, $mcpJson, $utf8)
  New-Item -ItemType Directory -Path $codexHome -Force | Out-Null
  # TOML literal strings preserve Windows backslashes; avoid quotes in paths.
  if ($mcp.Contains("'") -or $repo.Contains("'") -or $homeSandbox.Contains("'")) { throw 'Path containing a single quote cannot be written to TOML automatically.' }
  $toml = @"
[mcp_servers.concord]
command = '$mcp'
[mcp_servers.concord.env]
CONCORD_REPO_ROOT = '$repo'
CONCORD_TELEMETRY_DISABLED = '1'
CONCORD_NO_UPDATE_CHECK = '1'
CONCORD_AGENT_ID = 'codex:backend'
CONCORD_ALLOWED_ROOTS = '$repo'
HOME = '$homeSandbox'
USERPROFILE = '$homeSandbox'
"@
  [System.IO.File]::WriteAllText($codexConfigPath, $toml, $utf8)

  Write-Host '[4/4] Checking available adapters and workspace state...'
  & $concord status
  & $concord adapters status
} catch {
  Write-Host ''
  Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Partial state may exist. To start over, review then delete: .sandbox-tools, .sandbox-home, .sandbox-codex, .concord, .mcp.json (and restore any *.bak-* instruction file).'
  throw
} finally {
  $env:HOME = $oldHome
  $env:USERPROFILE = $oldUserProfile
}
Write-Host ''
Write-Host 'Review .mcp.json and .sandbox-codex/config.toml.'
Write-Host "For Codex in THIS terminal: `$env:CODEX_HOME = '$codexHome'"
Write-Host 'For both clients: launch from this project folder; restart existing sessions.'
Write-Host 'For live direct prompts, a separate opt-in adapter install may be needed.'
