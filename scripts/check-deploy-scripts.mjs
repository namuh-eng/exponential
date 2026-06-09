import { readFileSync } from "node:fs";

const deploy = readFileSync("scripts/deploy-ecs.sh", "utf8");
for (const expected of [
  "${APP_NAME}-api",
  "${APP_NAME}-web",
  "run_migration_task",
  "api-migrate-task-definition.json",
  "Go SQL migrations",
  "configure-ecs-autoscaling.sh",
  "aws ecs wait services-stable",
  "RUN_PROD_SMOKE",
  "scripts/smoke-prod.sh",
]) {
  if (!deploy.includes(expected)) {
    throw new Error(`deploy-ecs.sh must manage ${expected}`);
  }
}

const autoscaling = readFileSync(
  "scripts/configure-ecs-autoscaling.sh",
  "utf8",
);
for (const expected of [
  "register-scalable-target",
  "put-scaling-policy",
  "put-metric-alarm",
  "${APP_NAME}-api",
  "${APP_NAME}-web",
]) {
  if (!autoscaling.includes(expected)) {
    throw new Error(`configure-ecs-autoscaling.sh missing ${expected}`);
  }
}
