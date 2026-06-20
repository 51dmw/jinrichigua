#!/bin/bash
# jinrichigua PostgreSQL 每日备份 + 7 天轮转。
# 在容器内 pg_dump（在线安全，支持热备），gzip 落宿主。
# cron: 45 2 * * * /root/jinrichigua/deploy/backup-db.sh >> /root/jinrichigua/data/backups/backup.log 2>&1
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO/deploy/.env"
CONTAINER="jinrichigua-postgres-1"
DIR="$REPO/data/backups"
mkdir -p "$DIR"

DB=$(grep -E '^DATABASE_NAME=' "$ENV_FILE" | cut -d= -f2-)
DBUSER=$(grep -E '^DATABASE_USERNAME=' "$ENV_FILE" | cut -d= -f2-)
DBPW=$(grep -E '^DATABASE_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

TS=$(date +%Y%m%d-%H%M)
OUT="$DIR/${DB}.${TS}.sql.gz"

# 容器内 pg_dump → 宿主 gzip。PGPASSWORD 仅在 docker exec 环境内，不落盘。
docker exec -e PGPASSWORD="$DBPW" "$CONTAINER" pg_dump -U "$DBUSER" -d "$DB" --no-owner | gzip > "$OUT"

# 保留最近 7 天
find "$DIR" -name "${DB}.*.sql.gz" -mtime +7 -delete

# 校验：非空 + gzip 完整
if [ ! -s "$OUT" ] || ! gzip -t "$OUT" 2>/dev/null; then
  echo "[backup-db] $(date '+%F %T') FAIL: $OUT 无效" >&2
  rm -f "$OUT"
  exit 1
fi

echo "[backup-db] $(date '+%F %T') OK: $OUT ($(du -h "$OUT" | cut -f1))"
