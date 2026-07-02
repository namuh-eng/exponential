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
  SESSION_SECRET_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:session",
  PROVIDER_CREDENTIAL_ENCRYPTION_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:provider-credential-key",
  PROVIDER_CREDENTIAL_ENCRYPTION_KEY_ID: "env:v1",
  GOOGLE_CLIENT_ID_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:google-id",
  GOOGLE_CLIENT_SECRET_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:google-secret",
  METRICS_TOKEN_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:metrics",
  STRIPE_WEBHOOK_SIGNING_SECRET_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:stripe-webhook",
  STRIPE_SECRET_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:stripe-secret",
  STRIPE_CLOUD_TEAM_PRICE_ID: "price_team_test",
  STRIPE_CLOUD_BUSINESS_PRICE_ID: "price_business_test",
  OTEL_EXPORTER_OTLP_ENDPOINT: "collector.example:4318",
  S3_BUCKET: "attachments-bucket",
  S3_ENDPOINT: "https://s3-compatible.example",
  PUBLIC_BASE_URL: "https://app.example",
  WEB_INTERNAL_API_URL: "http://app-alb.example/api",
};

assert.equal(
  renderTemplate("${AWS_REGION}/${IMAGE_TAG}", env),
  "us-east-1/test-sha",
);
assert.throws(
  () => renderTemplate("${MISSING}", env),
  /Missing required environment variables/,
);
assert.equal(renderTemplate("${S3_BUCKET}/${S3_ENDPOINT}", {}), "/");
assert.throws(
  () =>
    renderTemplate("${DATABASE_URL_SECRET_ARN}", {
      ...env,
      DATABASE_URL_SECRET_ARN: "None",
    }),
  /Missing required environment variables: DATABASE_URL_SECRET_ARN/,
);
// Stripe ARNs are now optional — omitting them must not throw.
{
  const renderedWithoutStripe = renderTaskDefinitionFile(
    "infra/ecs/api-task-definition.json",
    {
      ...env,
      STRIPE_WEBHOOK_SIGNING_SECRET_SECRET_ARN: "",
      STRIPE_SECRET_KEY_SECRET_ARN: "",
    },
  );
  const parsedWithoutStripe = JSON.parse(renderedWithoutStripe);
  const secretNames = parsedWithoutStripe.containerDefinitions[0].secrets.map(
    (s) => s.name,
  );
  assert.ok(
    !secretNames.includes("STRIPE_WEBHOOK_SIGNING_SECRET"),
    "STRIPE_WEBHOOK_SIGNING_SECRET must be absent when ARN is empty",
  );
  assert.ok(
    !secretNames.includes("STRIPE_SECRET_KEY"),
    "STRIPE_SECRET_KEY must be absent when ARN is empty",
  );
}

// Fully absent (undefined) Stripe ARNs must also be tolerated.
{
  const {
    STRIPE_WEBHOOK_SIGNING_SECRET_SECRET_ARN: _w,
    STRIPE_SECRET_KEY_SECRET_ARN: _k,
    STRIPE_CLOUD_TEAM_PRICE_ID: _t,
    STRIPE_CLOUD_BUSINESS_PRICE_ID: _b,
    ...envNoStripe
  } = env;
  const rendered = renderTaskDefinitionFile(
    "infra/ecs/api-task-definition.json",
    envNoStripe,
  );
  const parsed = JSON.parse(rendered);
  const secretNames = parsed.containerDefinitions[0].secrets.map((s) => s.name);
  assert.ok(
    !secretNames.includes("STRIPE_WEBHOOK_SIGNING_SECRET"),
    "STRIPE_WEBHOOK_SIGNING_SECRET must be absent when ARN is undefined",
  );
  assert.ok(
    !secretNames.includes("STRIPE_SECRET_KEY"),
    "STRIPE_SECRET_KEY must be absent when ARN is undefined",
  );
  // STRIPE_CLOUD_*_PRICE_ID are plain environment vars (OPTIONAL_ENV_VARS_BY_KEY
  // path), not secrets — they must also be pruned from environment when absent.
  const envNames = (parsed.containerDefinitions[0].environment ?? []).map(
    (e) => e.name,
  );
  assert.ok(
    !envNames.includes("STRIPE_CLOUD_TEAM_PRICE_ID"),
    "STRIPE_CLOUD_TEAM_PRICE_ID must be absent from environment when undefined",
  );
  assert.ok(
    !envNames.includes("STRIPE_CLOUD_BUSINESS_PRICE_ID"),
    "STRIPE_CLOUD_BUSINESS_PRICE_ID must be absent from environment when undefined",
  );
}

for (const file of [
  "infra/ecs/api-task-definition.json",
  "infra/ecs/api-migrate-task-definition.json",
  "infra/ecs/web-task-definition.json",
]) {
  // Full env: all Stripe vars present.
  const rendered = renderTaskDefinitionFile(file, env);
  assert.doesNotMatch(rendered, /\$\{/);
  const parsed = JSON.parse(rendered);
  assert.ok(parsed.family);
  assert.ok(
    parsed.containerDefinitions[0].logConfiguration.options["awslogs-group"],
  );
  assert.notEqual(rendered, readFileSync(file, "utf8"));
}

// api task with Stripe present: secrets must include Stripe entries.
{
  const rendered = renderTaskDefinitionFile(
    "infra/ecs/api-task-definition.json",
    env,
  );
  const parsed = JSON.parse(rendered);
  const secretNames = parsed.containerDefinitions[0].secrets.map((s) => s.name);
  assert.ok(
    secretNames.includes("STRIPE_WEBHOOK_SIGNING_SECRET"),
    "STRIPE_WEBHOOK_SIGNING_SECRET must be present when ARN is provided",
  );
  assert.ok(
    secretNames.includes("STRIPE_SECRET_KEY"),
    "STRIPE_SECRET_KEY must be present when ARN is provided",
  );
}
// Opensend + R2 are optional: absent ARNs/vars must be pruned and must not throw.
{
  const rendered = renderTaskDefinitionFile(
    "infra/ecs/api-task-definition.json",
    env,
  );
  const parsed = JSON.parse(rendered);
  const secretNames = parsed.containerDefinitions[0].secrets.map((s) => s.name);
  for (const name of [
    "OPENSEND_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ]) {
    assert.ok(
      !secretNames.includes(name),
      `${name} must be absent when its ARN is undefined`,
    );
  }
  const envNames = (parsed.containerDefinitions[0].environment ?? []).map(
    (e) => e.name,
  );
  for (const name of ["EMAIL_PROVIDER", "SENDER_EMAIL", "OPENSEND_BASE_URL"]) {
    assert.ok(
      !envNames.includes(name),
      `${name} must be absent from environment when undefined`,
    );
  }
}

// Opensend + R2 present: the matching secret and environment entries must render.
{
  const rendered = renderTaskDefinitionFile(
    "infra/ecs/api-task-definition.json",
    {
      ...env,
      EMAIL_PROVIDER: "opensend",
      SENDER_EMAIL: "noreply@example.com",
      OPENSEND_BASE_URL: "https://opensend.example",
      OPENSEND_API_KEY_SECRET_ARN:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:opensend",
      R2_ACCESS_KEY_ID_SECRET_ARN:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:r2-id",
      R2_SECRET_ACCESS_KEY_SECRET_ARN:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:r2-secret",
    },
  );
  const parsed = JSON.parse(rendered);
  const secretNames = parsed.containerDefinitions[0].secrets.map((s) => s.name);
  for (const name of [
    "OPENSEND_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ]) {
    assert.ok(
      secretNames.includes(name),
      `${name} must be present when its ARN is provided`,
    );
  }
  const envEntries = parsed.containerDefinitions[0].environment ?? [];
  const emailProvider = envEntries.find((e) => e.name === "EMAIL_PROVIDER");
  assert.equal(
    emailProvider?.value,
    "opensend",
    "EMAIL_PROVIDER must render as opensend when provided",
  );
}
