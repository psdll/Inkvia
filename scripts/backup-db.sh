#!/usr/bin/env bash
# PostgreSQL 定时备份脚本。
# 建议配 cron 每日执行，例如：
#   0 3 * * *  cd /path/to/inkvia && bash scripts/backup-db.sh >> db-backups/backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./db-backups}"
KEEP="${KEEP:-14}"                       # 保留最近多少份
CONTAINER="${PG_CONTAINER:-inkvia_pg}"
DB="${PG_DB:-inkvia}"
DB_USER="${PG_USER:-app}"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/inkvia_${TS}.dump"
PART="$FILE.partial"

echo "[$(date)] 开始备份 -> $FILE"
docker exec "$CONTAINER" pg_dump -Fc -U "$DB_USER" -d "$DB" > "$PART"
test -s "$PART"
docker exec -i "$CONTAINER" pg_restore --list < "$PART" >/dev/null
mv "$PART" "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
echo "[$(date)] 备份完成：$(du -h "$FILE" | cut -f1)"

# 清理超出保留份数的旧备份
ls -1t "$BACKUP_DIR"/inkvia_*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old" "$old.sha256"
  echo "[$(date)] 已清理旧备份：$old"
done
