#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DB_SERVICE="${DB_SERVICE:-postgresdb}"
DB_NAME="${DB_NAME:-joplin}"
DB_USER="${DB_USER:-joplin}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%F-%H%M%S)"
backup_file="$BACKUP_DIR/joplin-db-$timestamp.sql.gz"

docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" \
	pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$backup_file"

size="$(du -h "$backup_file" | cut -f1)"
printf 'Backup written: %s (%s)
