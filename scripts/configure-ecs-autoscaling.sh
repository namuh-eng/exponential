#!/usr/bin/env bash
# Configure autoscaling and CloudWatch alarms for split ECS services.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
APP_NAME="${APP_NAME:-exponential}"
CLUSTER="${ECS_CLUSTER:-${APP_NAME}-cluster}"
MIN_CAPACITY="${ECS_MIN_CAPACITY:-1}"
MAX_CAPACITY="${ECS_MAX_CAPACITY:-6}"
CPU_TARGET="${ECS_CPU_TARGET:-60}"
MEMORY_TARGET="${ECS_MEMORY_TARGET:-70}"
ALARM_TOPIC_ARN="${ALARM_TOPIC_ARN:-}"

put_target_tracking_policy() {
  local service="$1"
  local metric="$2"
  local target="$3"
  local metric_slug
  metric_slug=$(printf '%s' "$metric" | tr '[:upper:]' '[:lower:]')
  local policy_name="${service}-${metric_slug}-target-tracking"

  aws application-autoscaling put-scaling-policy \
    --service-namespace ecs \
    --scalable-dimension ecs:service:DesiredCount \
    --resource-id "service/${CLUSTER}/${service}" \
    --policy-name "$policy_name" \
    --policy-type TargetTrackingScaling \
    --target-tracking-scaling-policy-configuration "{\"TargetValue\":${target},\"PredefinedMetricSpecification\":{\"PredefinedMetricType\":\"${metric}\"},\"ScaleInCooldown\":120,\"ScaleOutCooldown\":60}" \
    --region "$REGION" >/dev/null
}

register_service_autoscaling() {
  local service="$1"

  aws application-autoscaling register-scalable-target \
    --service-namespace ecs \
    --scalable-dimension ecs:service:DesiredCount \
    --resource-id "service/${CLUSTER}/${service}" \
    --min-capacity "$MIN_CAPACITY" \
    --max-capacity "$MAX_CAPACITY" \
    --region "$REGION" >/dev/null

  put_target_tracking_policy "$service" ECSServiceAverageCPUUtilization "$CPU_TARGET"
  put_target_tracking_policy "$service" ECSServiceAverageMemoryUtilization "$MEMORY_TARGET"
}

put_service_alarm() {
  local service="$1"
  local metric="$2"
  local threshold="$3"
  local comparison="$4"
  local statistic="$5"
  local alarm_action_args=""
  if [ -n "$ALARM_TOPIC_ARN" ]; then
    alarm_action_args="--alarm-actions $ALARM_TOPIC_ARN"
  fi

  # shellcheck disable=SC2086
  aws cloudwatch put-metric-alarm \
    --alarm-name "${service}-${metric}" \
    --namespace AWS/ECS \
    --metric-name "$metric" \
    --dimensions "Name=ClusterName,Value=${CLUSTER}" "Name=ServiceName,Value=${service}" \
    --statistic "$statistic" \
    --period 60 \
    --evaluation-periods 5 \
    --datapoints-to-alarm 3 \
    --threshold "$threshold" \
    --comparison-operator "$comparison" \
    --treat-missing-data notBreaching \
    $alarm_action_args \
    --region "$REGION" >/dev/null
}

for service in "${APP_NAME}-api" "${APP_NAME}-web"; do
  register_service_autoscaling "$service"
  put_service_alarm "$service" CPUUtilization 85 GreaterThanThreshold Average
  put_service_alarm "$service" MemoryUtilization 85 GreaterThanThreshold Average
  echo "Autoscaling and alarms configured for $service"
done
