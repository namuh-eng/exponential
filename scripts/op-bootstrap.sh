#!/usr/bin/env bash
# scripts/op-bootstrap.sh
# One-shot helper: read local .env and push current values into the
# 1Password vault items referenced by .env.1password.
#
# Run this once after migrating to the 1Password workflow, or whenever you
# want to sync local .env values back up to 1Password.
#
# This script never prints secret values. It also never leaves them in your
# shell history beyond what `.env` already exposes.

set -euo pipefail

ACCT="${OP_ACCOUNT:-namuhinc.1password.com}"
VAULT="${OP_VAULT:-Exponential}"
ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

if ! op --account "$ACCT" whoami >/dev/null 2>&1; then
  echo "error: not signed in to 1Password. run: op signin --account $ACCT" >&2
  exit 1
fi

# Load .env into this shell only.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

push() {
  local item="$1" field="$2" value="${3-}"
  if [ -z "$value" ]; then
    printf '  skip   %s.%s (empty in %s)\n' "$item" "$field" "$ENV_FILE"
    return
  fi
  op --account "$ACCT" item edit "$item" --vault="$VAULT" "$field=$value" >/dev/null
  printf '  pushed %s.%s\n' "$item" "$field"
}

echo "Pushing values from $ENV_FILE -> vault '$VAULT' on $ACCT"
push database     url            "${DATABASE_URL-}"
push redis        url            "${REDIS_URL-}"
push session      secret         "${EXPONENTIAL_SESSION_SECRET-}"
push google-oauth id             "${AUTH_GOOGLE_ID-}"
push google-oauth secret         "${AUTH_GOOGLE_SECRET-}"
push aws                  s3-bucket    "${S3_BUCKET-}"
push aws                  sender-email "${SENDER_EMAIL-}"
push opensend-exponential credential   "${OPENSEND_API_KEY-}"
echo "done."
