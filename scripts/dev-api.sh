#!/usr/bin/env bash
# Run the Go API for host-mode local dev with hot reload.
#
#   make dev-api          # uses air if available, else falls back to `go run`
#   NO_RELOAD=1 make dev-api   # plain `go run`, no watcher
#
# Loads .env (if present) and fills in dev defaults that match
# docker-compose.dev.yml so the API talks to the local Postgres/Redis started
# by `make dev-services`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load .env so secrets/overrides apply without re-exporting by hand.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${EXPONENTIAL_API_ADDR:=:7016}"
: "${EXPONENTIAL_API_DATABASE_URL:=${DATABASE_URL:-postgresql://postgres:password@localhost:15532/exponential?sslmode=disable}}"
: "${EXPONENTIAL_API_REDIS_URL:=${REDIS_URL:-redis://localhost:16379}}"
: "${EXPONENTIAL_API_ENVIRONMENT:=development}"
: "${EXPONENTIAL_API_SERVICE_NAME:=exponential-api}"
: "${EXPONENTIAL_SESSION_SECRET:=dev-session-secret-change-me-only-for-local}"
: "${EXPONENTIAL_PROVIDER_CREDENTIAL_ENCRYPTION_KEY:=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"
: "${EXPONENTIAL_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_ID:=dev:v1}"
: "${PUBLIC_BASE_URL:=http://localhost:7015}"

export EXPONENTIAL_API_ADDR EXPONENTIAL_API_DATABASE_URL EXPONENTIAL_API_REDIS_URL \
  EXPONENTIAL_API_ENVIRONMENT EXPONENTIAL_API_SERVICE_NAME EXPONENTIAL_SESSION_SECRET \
  EXPONENTIAL_PROVIDER_CREDENTIAL_ENCRYPTION_KEY EXPONENTIAL_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_ID \
  PUBLIC_BASE_URL

cd apps/api

if [ "${NO_RELOAD:-}" = "1" ]; then
  echo "[dev-api] NO_RELOAD=1 — running without hot reload"
  exec go run ./cmd/api
elif command -v air >/dev/null 2>&1; then
  exec air -c .air.toml
else
  echo "[dev-api] 'air' not found — running without hot reload."
  echo "[dev-api] Install for hot reload: go install github.com/air-verse/air@latest"
  exec go run ./cmd/api
fi
