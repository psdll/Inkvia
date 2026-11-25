#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BACKUP_FILE="${1:-}"
SOURCE_CONTAINER="${PG_CONTAINER:-inkvia_pg}"
DRILL_CONTAINER="${DRILL_CONTAINER:-}"
SOURCE_DB="${PG_DB:-inkvia}"
DB_USER="${PG_USER:-app}"
DRILL_DB="${DRILL_DB:-inkvia_recovery_drill_$(date +%Y%m%d%H%M%S)}"
REPORT_FILE="${REPORT_FILE:-recovery-drill-results/${DRILL_DB}.json}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

[[ -f "$BACKUP_FILE" ]] || { echo "backup file is required" >&2; exit 2; }
[[ "$DRILL_DB" =~ ^inkvia_recovery_drill_[0-9]{14}$ ]] || { echo "unsafe drill database name" >&2; exit 2; }
[[ -n "$DRILL_CONTAINER" ]] || { echo "DRILL_CONTAINER must name an isolated PostgreSQL drill container" >&2; exit 2; }
if [[ "$DRILL_CONTAINER" == "$SOURCE_CONTAINER" && "${ALLOW_SHARED_CLUSTER_DRILL:-}" != "$SOURCE_DB" ]]; then
  echo "shared-cluster drill refused; use an isolated DRILL_CONTAINER or explicitly set ALLOW_SHARED_CLUSTER_DRILL=$SOURCE_DB" >&2
  exit 2
fi
command -v docker >/dev/null
command -v "$PYTHON_BIN" >/dev/null
command -v awk >/dev/null

started_epoch="$(date +%s)"
backup_epoch="$(stat -c %Y "$BACKUP_FILE")"
rpo_seconds="$((started_epoch - backup_epoch))"
[[ "$rpo_seconds" -le 86400 ]] || { echo "RPO exceeds 24 hours" >&2; exit 1; }
docker exec -i "$DRILL_CONTAINER" pg_restore --list < "$BACKUP_FILE" >/dev/null
source_db_bytes="$(docker exec "$SOURCE_CONTAINER" psql -At -U "$DB_USER" -d "$SOURCE_DB" -c 'SELECT pg_database_size(current_database())')"
available_kb="$(docker exec "$DRILL_CONTAINER" sh -c 'df -Pk "${PGDATA:-/var/lib/postgresql/data}"' | awk 'END {print $4}')"
[[ "$source_db_bytes" =~ ^[0-9]+$ && "$available_kb" =~ ^[0-9]+$ ]] || { echo "unable to verify drill disk capacity" >&2; exit 1; }
available_bytes="$((available_kb * 1024))"
required_bytes="$((source_db_bytes * 2))"
[[ "$available_bytes" -ge "$required_bytes" ]] || { echo "drill target requires at least twice the source database size in free space" >&2; exit 1; }

cleanup() {
  docker exec "$DRILL_CONTAINER" dropdb --if-exists -U "$DB_USER" "$DRILL_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker exec "$DRILL_CONTAINER" createdb -U "$DB_USER" -O "$DB_USER" "$DRILL_DB"
docker exec -i "$DRILL_CONTAINER" pg_restore --exit-on-error --no-owner --no-privileges -U "$DB_USER" -d "$DRILL_DB" < "$BACKUP_FILE"

source_migrations="$(docker exec "$SOURCE_CONTAINER" psql -At -U "$DB_USER" -d "$SOURCE_DB" -c 'SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
drill_migrations="$(docker exec "$DRILL_CONTAINER" psql -At -U "$DB_USER" -d "$DRILL_DB" -c 'SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
source_tables="$(docker exec "$SOURCE_CONTAINER" psql -At -U "$DB_USER" -d "$SOURCE_DB" -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'")"
drill_tables="$(docker exec "$DRILL_CONTAINER" psql -At -U "$DB_USER" -d "$DRILL_DB" -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'")"
[[ "$source_migrations" == "$drill_migrations" ]] || { echo "migration count mismatch" >&2; exit 1; }
[[ "$source_tables" == "$drill_tables" ]] || { echo "table count mismatch" >&2; exit 1; }

finished_epoch="$(date +%s)"
rto_seconds="$((finished_epoch - started_epoch))"
[[ "$rto_seconds" -le 7200 ]] || { echo "RTO exceeds 2 hours" >&2; exit 1; }
mkdir -p "$(dirname "$REPORT_FILE")"
RPO_SECONDS="$rpo_seconds" RTO_SECONDS="$rto_seconds" SOURCE_MIGRATIONS="$source_migrations" TABLES="$source_tables" \
  BACKUP_FILE="$(basename "$BACKUP_FILE")" "$PYTHON_BIN" - <<'PY' > "$REPORT_FILE"
import datetime, json, os
print(json.dumps({
  "status": "passed",
  "completedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
  "backupFile": os.environ["BACKUP_FILE"],
  "rpoSeconds": int(os.environ["RPO_SECONDS"]),
  "rtoSeconds": int(os.environ["RTO_SECONDS"]),
  "migrationRows": int(os.environ["SOURCE_MIGRATIONS"]),
  "publicTables": int(os.environ["TABLES"]),
}, ensure_ascii=False, indent=2))
PY
echo "$REPORT_FILE"
