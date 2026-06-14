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

const preflight = readFileSync("scripts/preflight.sh", "utf8");
for (const expected of [
  'DB_INSTANCE_CLASS="${DB_INSTANCE_CLASS:-db.t3.micro}"',
  'DB_MULTI_AZ="$(normalize_bool "${DB_MULTI_AZ:-false}")"',
  'REDIS_NODE_TYPE="${REDIS_NODE_TYPE:-cache.t3.micro}"',
  'REDIS_REPLICATION_ENABLED="$(normalize_bool "${REDIS_REPLICATION_ENABLED:-false}")"',
  '--db-instance-class "$DB_INSTANCE_CLASS"',
  "aws rds modify-db-instance",
  "--multi-az",
  "--no-multi-az",
  '--cache-node-type "$REDIS_NODE_TYPE"',
  "aws elasticache create-replication-group",
  "--automatic-failover-enabled",
  "--replicas-per-node-group 1",
  "set_env_file REDIS_URL",
]) {
  if (!preflight.includes(expected)) {
    throw new Error(
      `preflight.sh missing data-tier resilience marker: ${expected}`,
    );
  }
}

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
for (const expected of [
  "deploy_lane",
  "github-hosted-oidc",
  "precheck-self-hosted-runner",
  "node scripts/check-github-runner.mjs",
  "GH_RUNNER_STATUS_TOKEN",
  "docs/deploy-runner-recovery.md",
  "runs-on: [self-hosted, exponential-deploy]",
  "deploy-cloud-fallback",
  "id-token: write",
  "aws-actions/configure-aws-credentials@v4",
  "AWS_DEPLOY_ROLE_ARN",
]) {
  if (!workflow.includes(expected)) {
    throw new Error(`deploy.yml missing runner resilience marker: ${expected}`);
  }
}

const runnerCheck = readFileSync("scripts/check-github-runner.mjs", "utf8");
for (const expected of [
  "/actions/runners",
  "REQUIRED_RUNNER_LABELS",
  "exponential-deploy",
  "deploy_lane=github-hosted-oidc",
  "local break-glass deploy",
]) {
  if (!runnerCheck.includes(expected)) {
    throw new Error(`check-github-runner.mjs missing ${expected}`);
  }
}

const deployReadme = readFileSync(".github/workflows/README.md", "utf8");
if (!deployReadme.includes("docs/deploy-runner-recovery.md")) {
  throw new Error(
    ".github/workflows/README.md must point to the deploy runner recovery runbook",
  );
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
  "ALARM_TOPIC_ARN",
]) {
  if (!autoscaling.includes(expected)) {
    throw new Error(`configure-ecs-autoscaling.sh missing ${expected}`);
  }
}

const prepare = readFileSync("scripts/prepare-ecs-deploy-env.sh", "utf8");
for (const expected of [
  "sns create-topic",
  "sns subscribe",
  "ALARM_EMAIL",
  "ALARM_TOPIC_ARN",
]) {
  if (!prepare.includes(expected)) {
    throw new Error(`prepare-ecs-deploy-env.sh missing ${expected}`);
  }
}

const deployScript = readFileSync("scripts/deploy-ecs.sh", "utf8");
if (!deployScript.includes("export ALARM_TOPIC_ARN")) {
  throw new Error(
    "deploy-ecs.sh must export ALARM_TOPIC_ARN before calling configure-ecs-autoscaling.sh",
  );
}
