#!/bin/sh
# POSIX 环境初始化：以 package-lock.json 为唯一依赖来源，并执行完整验证。
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=${1:-"$SCRIPT_DIR/../project"}

command -v node >/dev/null 2>&1 || { echo "未找到 Node.js（需要 20+）" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "未找到 npm" >&2; exit 1; }

npm --prefix "$PROJECT_DIR" ci --no-audit --no-fund
npm --prefix "$PROJECT_DIR" run verify
