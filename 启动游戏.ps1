$ErrorActionPreference = 'Stop'

$projectRoot = Join-Path $PSScriptRoot 'project'
$viteCli = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
$pathNode = Get-Command node -ErrorAction SilentlyContinue
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'

if ($pathNode) {
  $nodeExe = $pathNode.Source
} elseif (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
  $nodeExe = $bundledNode
} else {
  Write-Host '没有找到 Node.js。请安装 Node.js LTS 后重新双击本文件。' -ForegroundColor Red
  Write-Host '下载地址：https://nodejs.org/'
  Read-Host '按回车退出'
  exit 1
}

if (-not (Test-Path -LiteralPath $viteCli -PathType Leaf)) {
  Write-Host '项目依赖不完整，请先运行 handover_tools\restore_deps.ps1。' -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

Set-Location -LiteralPath $projectRoot
Write-Host ''
Write-Host '末日堡垒正在启动……' -ForegroundColor Cyan
Write-Host '浏览器访问：http://127.0.0.1:5173/' -ForegroundColor Green
Write-Host '停止游戏服务器：在本窗口按 Ctrl+C' -ForegroundColor Yellow
Write-Host ''
& $nodeExe $viteCli --host 127.0.0.1

