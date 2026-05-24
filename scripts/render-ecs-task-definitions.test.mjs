#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderTaskDefinitionFile,
  renderTemplate,
} from "./render-ecs-task-definitions.mjs";

const env = {
  AWS_ACCOUNT_ID: "123456789012",
  AWS_REGION: "us-east-1",
  IMAGE_TAG: "test-sha",
  ECS_EXECUTION_ROLE_ARN: "arn:aws:iam::123456789012:role/ecsExecution",
  ECS_TASK_ROLE_ARN: "arn:aws:iam::123456789012:role/ecsTask",
  DATABASE_URL_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:database",
  REDIS_URL_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:redis",
  KRATOS_DSN_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:kratos-dsn",
  KRATOS_COOKIE_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:kratos-cookie",
  GOOGLE_CLIENT_ID_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:google-id",
  GOOGLE_CLIENT_SECRET_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:google-secret",
  OTEL_EXPORTER_OTLP_ENDPOINT: "collector.example:4318",
  KRATOS_PUBLIC_URL: "https://app.example/auth",
  KRATOS_INTERNAL_URL: "http://kratos.internal:4433",
  PUBLIC_BASE_URL: "https://app.example",
};

assert.equal(
  renderTemplate("${AWS_REGION}/${IMAGE_TAG}", env),
  "us-east-1/test-sha",
);
assert.throws(
  () => renderTemplate("${MISSING}", env),
  /Missing required environment variables/,
);

for (const file of [
  "infra/ecs/api-task-definition.json",
  "infra/ecs/web-task-definition.json",
  "infra/ecs/kratos-task-definition.json",
]) {
  const rendered = renderTaskDefinitionFile(file, env);
  assert.doesNotMatch(rendered, /\$\{/);
  const parsed = JSON.parse(rendered);
  assert.ok(parsed.family);
  assert.ok(
    parsed.containerDefinitions[0].logConfiguration.options["awslogs-group"],
  );
  assert.notEqual(rendered, readFileSync(file, "utf8"));
}
