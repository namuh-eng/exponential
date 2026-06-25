#!/usr/bin/env bash
# One-command host dev: Postgres/Redis (+ migrations), Go API, and the web app.
#
#   make dev-full
#
# Starts the Docker infra services, then runs the API (hot reload via air) and
# the Next.js web app concurrently. Ctrl-C tears both down. The Docker services
# keep running in the background; stop them with `make dev-services-down`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[dev-full] Starting Postgres/Redis and applying migrations..."
pnpm --filter @exponential/web dev-services

echo "[dev-full] Starting Go API (:7016) and web (:7015)..."
bash scripts/dev-api.sh &
api_pid=$!
pnpm dev &
web_pid=$!

cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "[dev-full] Shutting down API and web..."
  kill "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Exit as soon as either process stops, then clean up the other.
wait -n
