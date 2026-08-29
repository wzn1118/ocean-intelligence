#!/usr/bin/env sh
set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
environment_file="${1:-$project_dir/deploy/production.env}"
backup_dir="${BACKUP_DIR:-$project_dir/backups/postgres}"
retention_days="${BACKUP_RETENTION_DAYS:-7}"

if [ ! -f "$environment_file" ]; then
  echo "Missing environment file: $environment_file" >&2
  exit 1
fi

set -a
. "$environment_file"
set +a

mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$backup_dir/.ocean-${timestamp}.sql.gz.tmp"
destination="$backup_dir/ocean-${timestamp}.sql.gz"

cd "$project_dir"
docker compose --env-file "$environment_file" -f compose.prod.yaml exec -T database \
  pg_dump --clean --if-exists --no-owner --no-privileges \
  -U "${POSTGRES_USER:-ocean}" "${POSTGRES_DB:-ocean_intelligence}" \
  | gzip -9 > "$temporary"
mv "$temporary" "$destination"
chmod 600 "$destination"

find "$backup_dir" -type f -name 'ocean-*.sql.gz' -mtime "+$retention_days" -delete
echo "Created $destination"
