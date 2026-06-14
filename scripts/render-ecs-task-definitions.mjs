#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const templates = [
  "infra/ecs/api-task-definition.json",
  "infra/ecs/api-migrate-task-definition.json",
  "infra/ecs/web-task-definition.json",
];

function parseArgs(argv) {
  const out = { outDir: "dist/ecs-task-definitions", env: process.env };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out-dir") {
      out.outDir = argv[index + 1];
      index += 1;
    }
  }
  return out;
}

// Variables that are allowed to be empty or absent. Empty-string values are
// substituted as-is rather than treated as missing. Variables in
// OPTIONAL_SECRETS_BY_ARN_KEY are additionally pruned from ECS secret arrays
// when their value is empty so that task definitions are valid without them.
// Variables in OPTIONAL_ENV_VARS_BY_KEY are pruned from the environment array.
const OPTIONAL_EMPTY_VARS = new Set([
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "STRIPE_WEBHOOK_SIGNING_SECRET_SECRET_ARN",
  "STRIPE_SECRET_KEY_SECRET_ARN",
  "STRIPE_CLOUD_TEAM_PRICE_ID",
  "STRIPE_CLOUD_BUSINESS_PRICE_ID",
]);

// Maps optional ARN env-var names to the ECS secret name they populate.
// When an ARN is absent/empty the matching secret entry is dropped from the
// rendered containerDefinitions[*].secrets array.
const OPTIONAL_SECRETS_BY_ARN_KEY = new Map([
  ["STRIPE_WEBHOOK_SIGNING_SECRET_SECRET_ARN", "STRIPE_WEBHOOK_SIGNING_SECRET"],
  ["STRIPE_SECRET_KEY_SECRET_ARN", "STRIPE_SECRET_KEY"],
]);

// Maps optional plain env-var names to the ECS environment entry name they
// populate. When the value is absent/empty the matching environment entry is
// dropped so ECS does not receive an empty string for a billing-only variable.
const OPTIONAL_ENV_VARS_BY_KEY = new Map([
  ["STRIPE_CLOUD_TEAM_PRICE_ID", "STRIPE_CLOUD_TEAM_PRICE_ID"],
  ["STRIPE_CLOUD_BUSINESS_PRICE_ID", "STRIPE_CLOUD_BUSINESS_PRICE_ID"],
]);

export function renderTemplate(input, env = process.env) {
  const missing = new Set();
  const rendered = input.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key) => {
    const value = env[key];
    const isOptional = OPTIONAL_EMPTY_VARS.has(key);
    const isAbsent = value === undefined || value === "" || value === "None";
    if (isAbsent && !isOptional) {
      missing.add(key);
      return "";
    }
    // Optional vars that are absent/None render as empty string; the
    // pruneOptionalEntries pass will remove those entries from the task def.
    return isAbsent ? "" : value;
  });
  if (missing.size > 0) {
    throw new Error(
      `Missing required environment variables: ${[...missing].sort().join(", ")}`,
    );
  }
  return rendered;
}

/**
 * Prune optional entries whose source value is empty or absent.
 *
 * - Secret entries: dropped when their ARN env-var is empty/absent (ECS rejects
 *   task definitions with empty valueFrom fields).
 * - Environment entries: dropped when their source env-var is empty/absent so
 *   that billing-only variables are not forwarded as empty strings to the
 *   container runtime.
 */
function pruneOptionalEntries(taskDef, env) {
  const emptySecretNames = new Set();
  for (const [arnKey, secretName] of OPTIONAL_SECRETS_BY_ARN_KEY) {
    const val = env[arnKey];
    if (val === undefined || val === "" || val === "None") {
      emptySecretNames.add(secretName);
    }
  }
  const emptyEnvNames = new Set();
  for (const [envKey, envName] of OPTIONAL_ENV_VARS_BY_KEY) {
    const val = env[envKey];
    if (val === undefined || val === "" || val === "None") {
      emptyEnvNames.add(envName);
    }
  }
  if (emptySecretNames.size === 0 && emptyEnvNames.size === 0) return taskDef;
  const clone = JSON.parse(JSON.stringify(taskDef));
  for (const container of clone.containerDefinitions ?? []) {
    if (Array.isArray(container.secrets) && emptySecretNames.size > 0) {
      container.secrets = container.secrets.filter(
        (entry) => !emptySecretNames.has(entry.name),
      );
    }
    if (Array.isArray(container.environment) && emptyEnvNames.size > 0) {
      container.environment = container.environment.filter(
        (entry) => !emptyEnvNames.has(entry.name),
      );
    }
  }
  return clone;
}

export function renderTaskDefinitionFile(file, env = process.env) {
  const rendered = renderTemplate(readFileSync(file, "utf8"), env);
  const taskDef = pruneOptionalEntries(JSON.parse(rendered), env);
  return `${JSON.stringify(taskDef, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { outDir, env } = parseArgs(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });
  for (const template of templates) {
    const outputPath = join(outDir, basename(template));
    writeFileSync(outputPath, renderTaskDefinitionFile(template, env));
    console.log(outputPath);
  }
}
