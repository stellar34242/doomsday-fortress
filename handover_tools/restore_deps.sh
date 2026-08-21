#!/bin/sh
# restore_deps.sh <目标项目目录> — node_modules 被环境回收后的快速恢复
# 优先从 node_modules_cache.tar.gz 秒级解压恢复（lock 哈希一致才可信）；缓存缺失/lock 已变更则回退 npm ci 并刷新缓存
# 用法: sh /mnt/agents/temp/zombie_td_work/restore_deps.sh /mnt/agents/temp/zombie_td_work/project
set -e
TGT="$1"
WORK=/mnt/agents/temp/zombie_td_work
CACHE=$WORK/node_modules_cache.tar.gz
LOCKSHA=$WORK/node_modules_cache.locksha

if [ -x "$TGT/node_modules/.bin/tsc" ]; then echo "DEPS_PRESENT $TGT"; exit 0; fi

CURSHA=$(sha256sum "$TGT/package-lock.json" | cut -d' ' -f1)
if [ -f "$CACHE" ] && [ -f "$LOCKSHA" ] && [ "$CURSHA" = "$(cat $LOCKSHA)" ]; then
  tar -xzf "$CACHE" -C "$TGT"
  if [ -x "$TGT/node_modules/.bin/tsc" ]; then echo "RESTORED_FROM_CACHE $TGT"; exit 0; fi
  echo "CACHE_EXTRACT_BAD → fallback npm ci"
else
  echo "CACHE_MISS_OR_LOCK_CHANGED → npm ci"
fi

npm --prefix "$TGT" ci --no-audit --no-fund >/dev/null 2>&1
# lock 一致时顺便刷新缓存（保证缓存永远跟在最后一次 npm ci 之后）
tar -czf "$CACHE" --warning=no-file-changed -C "$TGT" node_modules 2>/dev/null || tar -czf "$CACHE" -C "$TGT" node_modules
sha256sum "$TGT/package-lock.json" | cut -d' ' -f1 > "$LOCKSHA"
echo "RESTORED_BY_NPM_CI $TGT (cache refreshed)"
