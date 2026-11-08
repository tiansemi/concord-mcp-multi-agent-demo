# Launch Codex using only project-local MCP config.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:CODEX_HOME = Join-Path $repo '.sandbox-codex'
$env:CONCORD_REPO_ROOT = $repo
$env:CONCORD_ALLOWED_ROOTS = $repo
$env:CONCORD_TELEMETRY_DISABLED = '1'
# Prefer the .cmd shim: codex.ps1 is blocked when script execution is disabled.
$codex = Get-Command codex.cmd -ErrorAction SilentlyContinue
if (-not $codex) { $codex = Get-Command codex -ErrorAction SilentlyContinue }
if (-not $codex) { throw 'Codex CLI is not installed or not on PATH.' }
Push-Location $repo
try { & $codex.Source } finally { Pop-Location }
