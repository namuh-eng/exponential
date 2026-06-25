#!/usr/bin/env node
// Repeatable page-load (server TTFB) measurement harness.
//
// Measures the time for the web server to return the full HTML document for
// each route, under identical conditions: same server, same warm-up, same
// iteration count, fixed concurrency of 1 (sequential) to avoid contention.
//
// Usage:
//   node scripts/perf-measure.mjs [--base http://localhost:7015] [--iters 12] [--warmup 3] [--json out.json]
//
// "Page load" here = server response time for the navigation document
// (TTFB through full body receipt). This is the server-controllable portion
// of page load and is what code-level optimizations move.

import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}

const BASE = flag("base", "http://localhost:7015");
const ITERS = Number(flag("iters", "12"));
const WARMUP = Number(flag("warmup", "3"));
const JSON_OUT = flag("json", null);

// Routes to measure. Parametrized routes are excluded unless a concrete
// instance is provided here. Public pages render fully; (app) pages without a
// session redirect to login — both are legitimate "page load" outcomes whose
// server time we want under the threshold.
const ROUTES = [
  "/",
  "/pricing",
  "/changelog",
  "/customers",
  "/now",
  "/homepage",
  "/login",
  "/signup",
  "/signup/workspace",
  "/signup/invite",
  "/signup/finish",
  "/ssh-challenge",
  "/create-workspace",
  "/accept-invite",
  "/onboarding/invite",
  // (app) routes — exercise auth redirect + app shell path
  "/inbox",
  "/my-issues",
  "/projects",
  "/projects/all",
  "/initiatives",
  "/roadmap",
  "/cycles",
  "/teams",
  "/members",
  "/views",
  "/views/all",
  "/views/issues",
  "/views/projects",
  "/search",
  "/agent",
  "/settings",
  "/settings/workspace",
  "/settings/members",
  "/settings/security",
  "/settings/billing",
  "/settings/integrations",
  "/settings/api",
  "/settings/ai",
];

function pct(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

async function timeOnce(url) {
  const t0 = performance.now();
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "perf-measure" },
  });
  // Drain body so we measure full document transfer, not just headers.
  await res.arrayBuffer();
  const ms = performance.now() - t0;
  return { ms, status: res.status };
}

async function measureRoute(path) {
  const url = BASE + path;
  let status = 0;
  // Warm-up (not counted) — stabilizes JIT, route cache, connection.
  for (let i = 0; i < WARMUP; i++) {
    try {
      ({ status } = await timeOnce(url));
    } catch (e) {
      return { path, error: String(e?.message || e) };
    }
  }
  const samples = [];
  for (let i = 0; i < ITERS; i++) {
    const r = await timeOnce(url);
    samples.push(r.ms);
    status = r.status;
  }
  samples.sort((a, b) => a - b);
  return {
    path,
    status,
    min: +pct(samples, 0).toFixed(2),
    median: +pct(samples, 50).toFixed(2),
    p90: +pct(samples, 90).toFixed(2),
    max: +samples[samples.length - 1].toFixed(2),
  };
}

async function main() {
  const results = [];
  for (const path of ROUTES) {
    results.push(await measureRoute(path));
  }

  const measured = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);

  // Report sorted slowest-first by median.
  measured.sort((a, b) => b.median - a.median);

  const THRESHOLD = 50;
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `\n=== Page-load TTFB (ms) — base=${BASE} iters=${ITERS} warmup=${WARMUP} ===`,
  );
  console.log(
    `${pad("route", 34)}${pad("status", 8)}${pad("median", 9)}${pad("p90", 9)}${pad("min", 9)}${pad("max", 9)}`,
  );
  for (const r of measured) {
    const mark = r.median > THRESHOLD ? "  <-- OVER" : "";
    console.log(
      `${pad(r.path, 34)}${pad(r.status, 8)}${pad(r.median, 9)}${pad(r.p90, 9)}${pad(r.min, 9)}${pad(r.max, 9)}${mark}`,
    );
  }
  for (const f of failed) console.log(`${pad(f.path, 34)}ERROR: ${f.error}`);

  const over = measured.filter((r) => r.median > THRESHOLD);
  const allMedians = measured.map((r) => r.median).sort((a, b) => a - b);
  console.log(
    `\nSummary: ${measured.length} routes measured, ${failed.length} failed.`,
  );
  console.log(
    `Over ${THRESHOLD}ms (median): ${over.length} -> ${over.map((r) => r.path).join(", ") || "none"}`,
  );
  console.log(
    `Overall median of medians: ${pct(allMedians, 50)}ms; worst: ${allMedians[allMedians.length - 1]}ms`,
  );

  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify(
        { base: BASE, iters: ITERS, warmup: WARMUP, results },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${JSON_OUT}`);
  }

  process.exit(over.length === 0 && failed.length === 0 ? 0 : 1);
}

main();
