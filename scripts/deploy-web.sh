#!/usr/bin/env bash
# 安全部署前台（jrcg-web）：先构建到临时目录并校验成功，再原子切换 + 重启。
# 任何一步失败即中止，线上正在运行的 .next 完全不受影响（不会再出现构建失败导致的 502）。
#
# 用法：bash scripts/deploy-web.sh
# 原理：next.config.ts 的 distDir 读 NEXT_DIST_DIR。构建写 .next-build，
#       校验 BUILD_ID 存在后，mv .next→.next-prev、.next-build→.next，最后 pm2 restart。
set -euo pipefail

WEB=/root/jinrichigua/apps/web
BUILD_DIR=.next-build
LIVE=.next
PREV=.next-prev

cd /root/jinrichigua

echo "[deploy] 1/4 构建到临时目录 $BUILD_DIR ..."
rm -rf "$WEB/$BUILD_DIR"
NEXT_DIST_DIR="$BUILD_DIR" pnpm --filter web build

if [ ! -f "$WEB/$BUILD_DIR/BUILD_ID" ]; then
  echo "[deploy] ✗ 构建未产出 BUILD_ID，中止；线上 .next 未改动。" >&2
  rm -rf "$WEB/$BUILD_DIR"
  exit 1
fi
echo "[deploy] 2/4 构建成功（BUILD_ID=$(cat "$WEB/$BUILD_DIR/BUILD_ID")）"

echo "[deploy] 3/4 原子切换 .next ..."
rm -rf "$WEB/$PREV"
[ -d "$WEB/$LIVE" ] && mv "$WEB/$LIVE" "$WEB/$PREV"
mv "$WEB/$BUILD_DIR" "$WEB/$LIVE"

echo "[deploy] 4/4 重启 jrcg-web ..."
pm2 restart jrcg-web --update-env

# 健康检查：起不来则自动回滚到上一版 .next
for i in $(seq 1 30); do
  code=$(curl -sm 4 -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/ 2>/dev/null || echo 000)
  [ "$code" = "200" ] && { echo "[deploy] ✓ 上线成功（http 200）"; exit 0; }
  sleep 2
done

echo "[deploy] ✗ 健康检查失败，回滚到上一版 ..." >&2
if [ -d "$WEB/$PREV" ]; then
  rm -rf "$WEB/$LIVE"
  mv "$WEB/$PREV" "$WEB/$LIVE"
  pm2 restart jrcg-web --update-env
  echo "[deploy] 已回滚到上一版 .next" >&2
fi
exit 1
