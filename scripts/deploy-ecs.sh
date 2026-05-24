#!/usr/bin/env bash
# Build images, register task definitions, and create/update split ECS services.
set -euo pipefail

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
  KRATOS_DSN_SECRET_ARN KRATOS_COOKIE_SECRET_ARN GOOGLE_CLIENT_ID_SECRET_ARN \
  GOOGLE_CLIENT_SECRET_SECRET_ARN PUBLIC_BASE_URL KRATOS_PUBLIC_URL KRATOS_INTERNAL_URL \
  PRIV_SUBNET_A PRIV_SUBNET_B APP_SG API_TG_ARN WEB_TG_ARN KRATOS_TG_ARN; do
  require_env "$name"
done

export AWS_ACCOUNT_ID REGION AWS_REGION="$REGION" IMAGE_TAG
export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker build -f infra/docker/api.Dockerfile -t "$ECR_REGISTRY/${APP_NAME}-api:$IMAGE_TAG" .
docker build -f infra/docker/web.Dockerfile -t "$ECR_REGISTRY/${APP_NAME}-web:$IMAGE_TAG" .
docker build -f infra/docker/kratos.Dockerfile -t "$ECR_REGISTRY/${APP_NAME}-kratos:$IMAGE_TAG" .

docker push "$ECR_REGISTRY/${APP_NAME}-api:$IMAGE_TAG"
docker push "$ECR_REGISTRY/${APP_NAME}-web:$IMAGE_TAG"
docker push "$ECR_REGISTRY/${APP_NAME}-kratos:$IMAGE_TAG"

node scripts/render-ecs-task-definitions.mjs --out-dir "$TASK_OUT_DIR"

API_TASK_ARN=$(aws ecs register-task-definition --cli-input-json "file://${TASK_OUT_DIR}/api-task-definition.json" --region "$REGION" --query 'taskDefinition.taskDefinitionArn' --output text)
WEB_TASK_ARN=$(aws ecs register-task-definition --cli-input-json "file://${TASK_OUT_DIR}/web-task-definition.json" --region "$REGION" --query 'taskDefinition.taskDefinitionArn' --output text)
KRATOS_TASK_ARN=$(aws ecs register-task-definition --cli-input-json "file://${TASK_OUT_DIR}/kratos-task-definition.json" --region "$REGION" --query 'taskDefinition.taskDefinitionArn' --output text)

ensure_service() {
  local service="$1"
  local task_arn="$2"
  local target_group_arn="$3"
  local container_name="$4"
  local container_port="$5"

  if aws ecs describe-services --cluster "$CLUSTER" --services "$service" --region "$REGION" --query 'services[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
    aws ecs update-service --cluster "$CLUSTER" --service "$service" --task-definition "$task_arn" --desired-count "$DESIRED_COUNT" --region "$REGION" >/dev/null
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

ensure_service "${APP_NAME}-api" "$API_TASK_ARN" "$API_TG_ARN" api 3016
ensure_service "${APP_NAME}-web" "$WEB_TASK_ARN" "$WEB_TG_ARN" web 3000
ensure_service "${APP_NAME}-kratos" "$KRATOS_TASK_ARN" "$KRATOS_TG_ARN" kratos 4433

echo "Deployed ECS services: ${APP_NAME}-api, ${APP_NAME}-web, ${APP_NAME}-kratos"
