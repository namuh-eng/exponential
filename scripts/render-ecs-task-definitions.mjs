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

export function renderTemplate(input, env = process.env) {
  const optionalEmpty = new Set(["OTEL_EXPORTER_OTLP_ENDPOINT"]);
  const missing = new Set();
  const rendered = input.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key) => {
    const value = env[key];
    if (value === undefined || (value === "" && !optionalEmpty.has(key))) {
      missing.add(key);
      return "";
    }
    return value;
  });
  if (missing.size > 0) {
    throw new Error(
      `Missing required environment variables: ${[...missing].sort().join(", ")}`,
    );
  }
  return rendered;
}

export function renderTaskDefinitionFile(file, env = process.env) {
  const rendered = renderTemplate(readFileSync(file, "utf8"), env);
  return `${JSON.stringify(JSON.parse(rendered), null, 2)}\n`;
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
