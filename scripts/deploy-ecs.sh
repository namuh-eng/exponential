#!/usr/bin/env bash
# Build images, register task definitions, and create/update split ECS services.
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

REGION="${AWS_REGION:-us-east-1}"
APP_NAME="${APP_NAME:-exponential}"
CLUSTER="${ECS_CLUSTER:-${APP_NAME}-cluster}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
TASK_OUT_DIR="${TASK_OUT_DIR:-dist/ecs-task-definitions}"
DESIRED_COUNT="${DESIRED_COUNT:-1}"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env: $name" >&2
    exit 1
  fi
}

for name in \
  ECS_EXECUTION_ROLE_ARN ECS_TASK_ROLE_ARN DATABASE_URL_SECRET_ARN REDIS_URL_SECRET_ARN \
  SESSION_SECRET_SECRET_ARN GOOGLE_CLIENT_ID_SECRET_ARN GOOGLE_CLIENT_SECRET_SECRET_ARN PUBLIC_BASE_URL \
  METRICS_TOKEN_SECRET_ARN PRIV_SUBNET_A PRIV_SUBNET_B APP_SG ALB_SG API_TG_ARN WEB_TG_ARN; do
  require_env "$name"
done

export AWS_ACCOUNT_ID REGION AWS_REGION="$REGION" IMAGE_TAG
export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-}"

if [ -z "${WEB_INTERNAL_API_URL:-}" ]; then
  if [ -n "${ALB_DNS:-}" ]; then
    WEB_INTERNAL_API_URL="http://${ALB_DNS}/api"
  else
    RESOLVED_ALB_DNS=$(aws elbv2 describe-load-balancers \
      --names "${APP_NAME}-alb" \
      --region "$REGION" \
      --query 'LoadBalancers[0].DNSName' \
      --output text 2>/dev/null || true)
    if [ -n "$RESOLVED_ALB_DNS" ] && [ "$RESOLVED_ALB_DNS" != "None" ]; then
      WEB_INTERNAL_API_URL="http://${RESOLVED_ALB_DNS}/api"
    else
      WEB_INTERNAL_API_URL="${PUBLIC_BASE_URL%/}/api"
    fi
  fi
fi
export WEB_INTERNAL_API_URL
echo "Web server API URL: ${WEB_INTERNAL_API_URL}"

ensure_app_ingress() {
  local port="$1"
  local source_group="$2"

  aws ec2 authorize-security-group-ingress \
    --group-id "$APP_SG" \
    --protocol tcp \
    --port "$port" \
    --source-group "$source_group" \
    --region "$REGION" >/dev/null 2>&1 || true
}

# Keep deploy idempotent after service port changes. Existing environments may
# have been provisioned with the old monolith/API ports, so do not assume a
# fresh preflight has already opened the split-service API port.
ensure_app_ingress 3000 "$ALB_SG"
ensure_app_ingress 7016 "$ALB_SG"
ensure_app_ingress 7016 "$APP_SG"

if [ -z "${DEPLOY_SKIP_ECR_LOGIN:-}" ]; then
  # Local break-glass path: laptop docker has a working keychain.
  # CI path sets DEPLOY_SKIP_ECR_LOGIN=1 and configures a credHelper instead,
  # because docker login under launchd can't unlock the macOS keychain to
  # persist credentials (errSecInteractionNotAllowed).
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
fi

docker build --platform linux/amd64 -f infra/docker/api.Dockerfile -t "$ECR_REGISTRY/${APP_NAME}-api:$IMAGE_TAG" .
docker build --platform linux/amd64 -f infra/docker/web.Dockerfile -t "$ECR_REGISTRY/${APP_NAME}-web:$IMAGE_TAG" .

docker push "$ECR_REGISTRY/${APP_NAME}-api:$IMAGE_TAG"
docker push "$ECR_REGISTRY/${APP_NAME}-web:$IMAGE_TAG"

ensure_log_group() {
  local group="$1"
  if ! aws logs describe-log-groups \
    --log-group-name-prefix "$group" \
    --region "$REGION" \
    --query "logGroups[?logGroupName==\`$group\`].logGroupName | [0]" \
    --output text | grep -qx "$group"; then
    aws logs create-log-group --log-group-name "$group" --region "$REGION"
  fi
}

ensure_log_group "/ecs/${APP_NAME}-api"
ensure_log_group "/ecs/${APP_NAME}-api-migrate"
ensure_log_group "/ecs/${APP_NAME}-web"

node scripts/render-ecs-task-definitions.mjs --out-dir "$TASK_OUT_DIR"

API_TASK_ARN=$(aws ecs register-task-definition --cli-input-json "file://${TASK_OUT_DIR}/api-task-definition.json" --region "$REGION" --query 'taskDefinition.taskDefinitionArn' --output text)
API_MIGRATE_TASK_ARN=$(aws ecs register-task-definition --cli-input-json "file://${TASK_OUT_DIR}/api-migrate-task-definition.json" --region "$REGION" --query 'taskDefinition.taskDefinitionArn' --output text)
WEB_TASK_ARN=$(aws ecs register-task-definition --cli-input-json "file://${TASK_OUT_DIR}/web-task-definition.json" --region "$REGION" --query 'taskDefinition.taskDefinitionArn' --output text)

run_migration_task() {
  local label="$1"
  local task_arn="$2"
  local container_name="$3"
  shift 3

  local overrides='{}'
  if [ "$#" -gt 0 ]; then
    overrides=$(node -e 'const [name,...cmd]=process.argv.slice(1); console.log(JSON.stringify({containerOverrides:[{name,command:cmd}]}));' "$container_name" "$@")
  fi

  echo "Running one-off ECS task: $label"
  local task
  task=$(aws ecs run-task \
    --cluster "$CLUSTER" \
    --task-definition "$task_arn" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$PRIV_SUBNET_A,$PRIV_SUBNET_B],securityGroups=[$APP_SG],assignPublicIp=DISABLED}" \
    --overrides "$overrides" \
    --region "$REGION" \
    --query 'tasks[0].taskArn' \
    --output text)

  if [ -z "$task" ] || [ "$task" = "None" ]; then
    echo "Failed to start migration task: $label" >&2
    exit 1
  fi

  aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task" --region "$REGION"
  local exit_code
  exit_code=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --region "$REGION" --query "tasks[0].containers[?name==\`$container_name\`].exitCode | [0]" --output text)
  if [ "$exit_code" != "0" ]; then
    aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --region "$REGION" --query 'tasks[0].stoppedReason' --output text >&2 || true
    echo "Migration task failed: $label (exit $exit_code)" >&2
    exit 1
  fi
}

run_migration_task "Go SQL migrations" "$API_MIGRATE_TASK_ARN" api-migrate

ensure_service() {
  local service="$1"
  local task_arn="$2"
  local target_group_arn="$3"
  local container_name="$4"
  local container_port="$5"

  if aws ecs describe-services --cluster "$CLUSTER" --services "$service" --region "$REGION" --query 'services[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
    aws ecs update-service \
      --cluster "$CLUSTER" \
      --service "$service" \
      --task-definition "$task_arn" \
      --desired-count "$DESIRED_COUNT" \
      --load-balancers "targetGroupArn=$target_group_arn,containerName=$container_name,containerPort=$container_port" \
      --region "$REGION" >/dev/null
  else
    aws ecs create-service \
      --cluster "$CLUSTER" \
      --service-name "$service" \
      --task-definition "$task_arn" \
      --desired-count "$DESIRED_COUNT" \
      --launch-type FARGATE \
      --network-configuration "awsvpcConfiguration={subnets=[$PRIV_SUBNET_A,$PRIV_SUBNET_B],securityGroups=[$APP_SG],assignPublicIp=DISABLED}" \
      --load-balancers "targetGroupArn=$target_group_arn,containerName=$container_name,containerPort=$container_port" \
      --region "$REGION" >/dev/null
  fi
}

ensure_service "${APP_NAME}-api" "$API_TASK_ARN" "$API_TG_ARN" api 7016
ensure_service "${APP_NAME}-web" "$WEB_TASK_ARN" "$WEB_TG_ARN" web 3000

if [ "${WAIT_FOR_STABILITY:-true}" != "false" ]; then
  aws ecs wait services-stable \
    --cluster "$CLUSTER" \
    --services "${APP_NAME}-api" "${APP_NAME}-web" \
    --region "$REGION"
fi

if [ "${CONFIGURE_AUTOSCALING:-true}" != "false" ]; then
  scripts/configure-ecs-autoscaling.sh
fi

if [ "${RUN_PROD_SMOKE:-false}" = "true" ]; then
  PUBLIC_BASE_URL="$PUBLIC_BASE_URL" scripts/smoke-prod.sh
else
  echo "Skipping production smoke. Set RUN_PROD_SMOKE=true to run scripts/smoke-prod.sh after service stability."
fi

echo "Deployed ECS services: ${APP_NAME}-api, ${APP_NAME}-web"
