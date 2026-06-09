#!/usr/bin/env bash
# Push Google OAuth credentials from .env into AWS Secrets Manager and force
# the ECS API service to pull the new values. Re-run any time the credentials
# change (e.g. after editing AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET in .env).
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
set -a; . "$ENV_FILE"; set +a

REGION="${AWS_REGION:-us-east-1}"
APP_NAME="${APP_NAME:-exponential}"
CLUSTER="${ECS_CLUSTER:-${APP_NAME}-cluster}"
API_SERVICE="${API_SERVICE:-${APP_NAME}-api}"

CLIENT_ID="${GOOGLE_CLIENT_ID:-${AUTH_GOOGLE_ID:-}}"
CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-${AUTH_GOOGLE_SECRET:-}}"

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET (or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET) must be set in $ENV_FILE" >&2
  exit 1
fi

case "$CLIENT_ID" in
  dev-*|"") echo "Refusing to push placeholder client id: $CLIENT_ID" >&2; exit 1 ;;
esac

echo "Updating ${APP_NAME}/google-client-id ..."
aws secretsmanager put-secret-value --region "$REGION" \
  --secret-id "${APP_NAME}/google-client-id" \
  --secret-string "$CLIENT_ID" >/dev/null

echo "Updating ${APP_NAME}/google-client-secret ..."
aws secretsmanager put-secret-value --region "$REGION" \
  --secret-id "${APP_NAME}/google-client-secret" \
  --secret-string "$CLIENT_SECRET" >/dev/null

echo "Forcing new deployment of $API_SERVICE on $CLUSTER ..."
aws ecs update-service --region "$REGION" \
  --cluster "$CLUSTER" --service "$API_SERVICE" \
  --force-new-deployment >/dev/null

echo "Done. Waiting for service to stabilize (up to 10 min)..."
aws ecs wait services-stable --region "$REGION" \
  --cluster "$CLUSTER" --services "$API_SERVICE"
echo "$API_SERVICE stable. New OAuth credentials are live."
