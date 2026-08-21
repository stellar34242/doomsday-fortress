param(
  [string]$ProjectDir = (Join-Path $PSScriptRoot '..\project')
)

$ErrorActionPreference = 'Stop'
$ProjectDir = (Resolve-Path -LiteralPath $ProjectDir).Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '未找到 Node.js（需要 20+）'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw '未找到 npm'
}

& npm --prefix $ProjectDir ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& npm --prefix $ProjectDir run verify
exit $LASTEXITCODE
