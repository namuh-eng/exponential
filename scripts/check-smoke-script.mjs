import { readFileSync } from "node:fs";

const source = readFileSync("scripts/smoke-prod.sh", "utf8");
for (const expected of [
  "/api/healthz",
  "/api/metrics",
  "/api/metrics/red",
  "exponential_http_requests_total",
  "exponential_http_request_duration_seconds",
  "EXPONENTIAL_TOKEN",
  "EXPONENTIAL_METRICS_TOKEN",
]) {
  if (!source.includes(expected)) {
    throw new Error(`smoke-prod.sh missing ${expected}`);
  }
}
