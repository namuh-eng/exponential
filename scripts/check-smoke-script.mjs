import { readFileSync } from "node:fs";

const source = readFileSync("scripts/smoke-prod.sh", "utf8");
for (const expected of [
  "/api/healthz",
  "/api/metrics/red",
  "EXPONENTIAL_TOKEN",
  "EXPONENTIAL_METRICS_TOKEN",
]) {
  if (!source.includes(expected)) {
    throw new Error(`smoke-prod.sh missing ${expected}`);
  }
}
