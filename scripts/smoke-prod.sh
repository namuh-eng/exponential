#!/usr/bin/env bash
# Smoke-test a deployed split stack behind the public ALB URL.
set -euo pipefail

PUBLIC_BASE_URL="${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL, e.g. https://app.example.com}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
API_TOKEN="${EXPONENTIAL_TOKEN:-}"
METRICS_TOKEN="${EXPONENTIAL_METRICS_TOKEN:-}"
if [ -z "$METRICS_TOKEN" ] && [ -n "${METRICS_TOKEN_SECRET_ARN:-}" ]; then
  METRICS_TOKEN=$(aws secretsmanager get-secret-value \
    --secret-id "$METRICS_TOKEN_SECRET_ARN" \
    --region "${AWS_REGION:-us-east-1}" \
    --query SecretString \
    --output text)
fi

curl_json() {
  local url="$1"
  shift || true
  curl --fail --silent --show-error --location \
    --connect-timeout 5 \
    --max-time 20 \
    -H 'Accept: application/json' \
    "$@" \
    "$url"
}

expect_json_field() {
  local json="$1"
  local field="$2"
  node -e 'const input=JSON.parse(process.argv[1]); if (!(process.argv[2] in input)) process.exit(1)' "$json" "$field"
}

echo "Smoking web root: ${PUBLIC_BASE_URL}/"
curl --fail --silent --show-error --location --connect-timeout 5 --max-time 20 "${PUBLIC_BASE_URL}/" >/dev/null

echo "Smoking Go API health through /api: ${PUBLIC_BASE_URL}/api/healthz"
health_json=$(curl_json "${PUBLIC_BASE_URL}/api/healthz")
expect_json_field "$health_json" status

echo "Smoking RED metrics through /api: ${PUBLIC_BASE_URL}/api/metrics/red"
if [ -z "$METRICS_TOKEN" ]; then
  echo "EXPONENTIAL_METRICS_TOKEN or METRICS_TOKEN_SECRET_ARN must be set for production metrics smoke" >&2
  exit 1
fi
metrics_json=$(curl_json "${PUBLIC_BASE_URL}/api/metrics/red" -H "X-Metrics-Token: ${METRICS_TOKEN}")
expect_json_field "$metrics_json" endpoints


if [ -n "$API_TOKEN" ]; then
  echo "Smoking authenticated issues endpoint"
  curl_json "${PUBLIC_BASE_URL}/api/issues?limit=1" -H "Authorization: Bearer ${API_TOKEN}" >/dev/null
else
  echo "Skipping authenticated API smoke because EXPONENTIAL_TOKEN is unset"
fi

echo "Smoke passed: web, API health, RED metrics${API_TOKEN:+, authenticated API}."
