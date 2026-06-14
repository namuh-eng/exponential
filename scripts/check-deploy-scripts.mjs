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
]) {
  if (!autoscaling.includes(expected)) {
    throw new Error(`configure-ecs-autoscaling.sh missing ${expected}`);
  }
}
