#!/usr/bin/env bash
# Prepare local .env entries needed by scripts/deploy-ecs.sh.
# Safe to rerun: IAM roles, Secrets Manager secrets, and .env keys are upserted.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
APP_NAME="${APP_NAME:-exponential}"
ENV_FILE="${ENV_FILE:-.env}"
ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a && . "$ENV_FILE" && set +a
fi

touch "$ENV_FILE"
chmod 600 "$ENV_FILE" 2>/dev/null || true

random_hex() {
  openssl rand -hex "${1:-24}"
}

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    python3 - "$ENV_FILE" "$key" "$value" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text().splitlines()
for index, line in enumerate(lines):
    if line.startswith(f"{key}="):
        lines[index] = f"{key}={value}"
        break
path.write_text("\n".join(lines) + "\n")
PY
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
  export "$key=$value"
}

secret_arn() {
  local name="$1"
  local value="$2"
  if aws secretsmanager describe-secret --secret-id "$name" --region "$REGION" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id "$name" --secret-string "$value" --region "$REGION" >/dev/null
  else
    aws secretsmanager create-secret --name "$name" --secret-string "$value" --region "$REGION" >/dev/null
  fi
  aws secretsmanager describe-secret --secret-id "$name" --region "$REGION" --query ARN --output text
}

role_arn() {
  local role_name="$1"
  local policy_doc="$2"
  if ! aws iam get-role --role-name "$role_name" >/dev/null 2>&1; then
    aws iam create-role \
      --role-name "$role_name" \
      --assume-role-policy-document "$policy_doc" >/dev/null
  fi
  aws iam get-role --role-name "$role_name" --query 'Role.Arn' --output text
}

TRUST_FILE=$(mktemp)
cat >"$TRUST_FILE" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

EXEC_ROLE="${APP_NAME}-ecs-execution-role"
TASK_ROLE="${APP_NAME}-ecs-task-role"
EXEC_ROLE_ARN=$(role_arn "$EXEC_ROLE" "file://${TRUST_FILE}")
TASK_ROLE_ARN=$(role_arn "$TASK_ROLE" "file://${TRUST_FILE}")
rm -f "$TRUST_FILE"

aws iam attach-role-policy \
  --role-name "$EXEC_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null 2>&1 || true

SECRETS_POLICY=$(mktemp)
cat >"$SECRETS_POLICY" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue", "kms:Decrypt"],
      "Resource": "arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:${APP_NAME}/*"
    }
  ]
}
JSON
aws iam put-role-policy \
  --role-name "$EXEC_ROLE" \
  --policy-name "${APP_NAME}-read-task-secrets" \
  --policy-document "file://${SECRETS_POLICY}" >/dev/null
rm -f "$SECRETS_POLICY"

LOGS_POLICY=$(mktemp)
cat >"$LOGS_POLICY" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup"],
      "Resource": "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/ecs/${APP_NAME}-*"
    }
  ]
}
JSON
aws iam put-role-policy \
  --role-name "$EXEC_ROLE" \
  --policy-name "${APP_NAME}-create-task-log-groups" \
  --policy-document "file://${LOGS_POLICY}" >/dev/null
rm -f "$LOGS_POLICY"

TASK_POLICY=$(mktemp)
cat >"$TASK_POLICY" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail", "ses:SendBulkEmail"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::${S3_BUCKET:-${APP_NAME}-assets-${REGION}}",
        "arn:aws:s3:::${S3_BUCKET:-${APP_NAME}-assets-${REGION}}/*"
      ]
    }
  ]
}
JSON
aws iam put-role-policy \
  --role-name "$TASK_ROLE" \
  --policy-name "${APP_NAME}-app-runtime-access" \
  --policy-document "file://${TASK_POLICY}" >/dev/null
rm -f "$TASK_POLICY"

set_env AWS_REGION "$REGION"
set_env AWS_ACCOUNT_ID "$ACCOUNT_ID"
set_env ECS_EXECUTION_ROLE_ARN "$EXEC_ROLE_ARN"
set_env ECS_TASK_ROLE_ARN "$TASK_ROLE_ARN"

if [ -z "${DB_PASSWORD:-}" ]; then
  set_env DB_PASSWORD "$(random_hex 24)"
fi
if [ -n "${ALB_DNS:-}" ] && [ -z "${PUBLIC_BASE_URL:-}" ]; then
  set_env PUBLIC_BASE_URL "http://${ALB_DNS}"
fi
if [ -n "${ALB_DNS:-}" ] && [ -z "${WEB_INTERNAL_API_URL:-}" ]; then
  set_env WEB_INTERNAL_API_URL "http://${ALB_DNS}/api"
fi
if [ -n "${DATABASE_URL:-}" ]; then
  set_env DATABASE_URL_SECRET_ARN "$(secret_arn "${APP_NAME}/database-url" "$DATABASE_URL")"
fi
if [ -n "${REDIS_URL:-}" ]; then
  set_env REDIS_URL_SECRET_ARN "$(secret_arn "${APP_NAME}/redis-url" "$REDIS_URL")"
fi
if [ -z "${EXPONENTIAL_SESSION_SECRET:-}" ]; then
  set_env EXPONENTIAL_SESSION_SECRET "$(random_hex 32)"
fi
if [ -z "${EXPONENTIAL_METRICS_TOKEN:-}" ]; then
  set_env EXPONENTIAL_METRICS_TOKEN "$(random_hex 32)"
fi
set_env SESSION_SECRET_SECRET_ARN "$(secret_arn "${APP_NAME}/session-secret" "$EXPONENTIAL_SESSION_SECRET")"
set_env METRICS_TOKEN_SECRET_ARN "$(secret_arn "${APP_NAME}/metrics-token" "$EXPONENTIAL_METRICS_TOKEN")"
set_env GOOGLE_CLIENT_ID_SECRET_ARN "$(secret_arn "${APP_NAME}/google-client-id" "${GOOGLE_CLIENT_ID:-${AUTH_GOOGLE_ID:-dev-google-client-id}}")"
set_env GOOGLE_CLIENT_SECRET_SECRET_ARN "$(secret_arn "${APP_NAME}/google-client-secret" "${GOOGLE_CLIENT_SECRET:-${AUTH_GOOGLE_SECRET:-dev-google-client-secret}}")"

cat <<MSG
Prepared ECS deploy environment in ${ENV_FILE}.

Next steps:
1. If this is the first AWS run, run: DB_PASSWORD=\$DB_PASSWORD scripts/preflight.sh
2. Re-run this script after preflight so DATABASE_URL/REDIS_URL/ALB_DNS are converted into secret ARNs and public/internal URLs.
3. Deploy with: set -a; . ${ENV_FILE}; set +a; RUN_PROD_SMOKE=true scripts/deploy-ecs.sh
MSG
