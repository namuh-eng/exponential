#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/reset-demo.sh", "utf8");
const workflow = readFileSync(".github/workflows/reset-demo.yml", "utf8");

assert.match(
  workflow,
  /EXPONENTIAL_API_DATABASE_URL:\s*\$\{\{ secrets\.EXPONENTIAL_DEMO_DATABASE_URL \}\}/,
  "reset workflow must pass the demo DB secret via EXPONENTIAL_API_DATABASE_URL",
);
assert.match(
  script,
  /DATABASE_URL=\$EXPONENTIAL_API_DATABASE_URL\n\s*export DATABASE_URL/,
  "reset script must map EXPONENTIAL_API_DATABASE_URL to DATABASE_URL for config.Load",
);
assert.match(
  script,
  /go run \.\/cmd\/demo-reset/,
  "reset script must run the demo reset command",
);
