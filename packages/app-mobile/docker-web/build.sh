#!/usr/bin/env bash
#
# Build the Joplin mobile-web bundle locally, then rebuild the Docker container.
#
# Usage:
#   ./build.sh           # full build (tsc + webpack + docker)
#   ./build.sh --skip-tsc  # skip tsc if you know TS is already compiled
#   ./build.sh --docker-only  # skip tsc + webpack, just rebuild Docker image
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

skip_tsc=false
docker_only=false

for arg in "$@"; do
	case "$arg" in
		--skip-tsc) skip_tsc=true ;;
		--docker-only) docker_only=true ;;
		*) echo "Unknown flag: $arg"; exit 1 ;;
	esac
done

cd "$REPO_ROOT"

if [ "$docker_only" = false ]; then
	if [ "$skip_tsc" = false ]; then
		echo "==> Compiling TypeScript (htmlpack, lib, app-mobile)..."
		yarn workspace @joplin/htmlpack tsc
		yarn workspace @joplin/lib tsc
		yarn workspace @joplin/app-mobile tsc
	else
		echo "==> Skipping tsc (--skip-tsc)"
	fi

	echo "==> Building webpack bundle..."
	yarn workspace @joplin/app-mobile web
else
	echo "==> Skipping tsc + webpack (--docker-only)"
fi

echo "==> Building and starting Docker container..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> Done. Container status:"
docker compose -f "$COMPOSE_FILE" ps
