#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
	printf 'Usage: %s <backup.sql|backup.sql.gz> [--yes]
	exit 1
fi

BACKUP_FILE="$1"
CONFIRM="${2:-}"

if [[ ! -f "$BACKUP_FILE" ]]; then
	printf 'Backup file not found: %s
	exit 1
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DB_SERVICE="${DB_SERVICE:-postgresdb}"
DB_NAME="${DB_NAME:-joplin}"
DB_USER="${DB_USER:-joplin}"

if [[ "$CONFIRM" != "--yes" ]]; then
	printf 'This will replace database "%s" in service "%s". Re-run with --yes to continue.
	exit 1
fi

docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" \
	psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
	-c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

if [[ "$BACKUP_FILE" == *.gz ]]; then
	gunzip -c "$BACKUP_FILE" | docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" \
		psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1
else
	docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" \
		psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$BACKUP_FILE"
fi

printf 'Restore completed from %s
