#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/../apps/api"

if [ -n "${EXPONENTIAL_API_DATABASE_URL:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
  export EXPONENTIAL_API_DATABASE_URL
fi

go run ./cmd/demo-reset
