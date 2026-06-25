#!/usr/bin/env node
// Authenticated, browser-based page-load measurement.
//
// Unlike perf-measure.mjs (server TTFB via curl), this drives a real Chromium
// instance with a logged-in session and captures what a user actually feels:
//   - ttfb:   responseStart - requestStart (server document time)
//   - domcl:  domContentLoaded relative to navigation start
//   - load:   load event relative to navigation start
//   - fcp:    first-contentful-paint (when pixels first appear)
//   - ready:  time until the page's primary content selector is visible
//             (the real "I can use this page" moment, incl. client data fetch)
//
// Usage:
//   node scripts/perf-measure-auth.mjs --base http://localhost:7015 \
//     --cookies "exponential_session=...; activeWorkspaceId=...; activeWorkspaceSlug=..." \
//     --iters 8 --warmup 2 --json out.json
//
// Routes are provided in ROUTES below with a `ready` selector each.

import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const BASE = flag("base", "http://localhost:7015");
const COOKIES = flag("cookies", "");
const ITERS = Number(flag("iters", "8"));
const WARMUP = Number(flag("warmup", "2"));
const JSON_OUT = flag("json", null);
const SLUG = flag("slug", "foreverbrowsing");

// Each route names a selector that marks its primary content as rendered.
// `main` is a safe fallback that exists once the app shell hydrates.
const ROUTES = [
  { path: `/`, ready: "main, [data-app-shell], a[href*='/inbox']" },
  { path: `/${SLUG}/inbox`, ready: "main" },
  { path: `/${SLUG}/my-issues/assigned`, ready: "main" },
  { path: `/${SLUG}/team/ENG/all`, ready: "main" },
  { path: `/${SLUG}/team/ENG/board`, ready: "main" },
  { path: `/${SLUG}/team/ENG/active`, ready: "main" },
  { path: `/${SLUG}/projects`, ready: "main" },
  { path: `/${SLUG}/initiatives`, ready: "main" },
  { path: `/${SLUG}/roadmap`, ready: "main" },
  { path: `/${SLUG}/cycles`, ready: "main" },
  { path: `/${SLUG}/search`, ready: "main" },
  { path: `/${SLUG}/settings`, ready: "main" },
  { path: `/${SLUG}/settings/members`, ready: "main" },
];

function pct(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return +sorted[idx].toFixed(1);
}

function parseCookies(raw, urlHost) {
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return {
        name: pair.slice(0, eq).trim(),
        value: pair.slice(eq + 1).trim(),
        domain: urlHost,
        path: "/",
      };
    });
}

async function measure(page, route) {
  const url = BASE + route.path;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "commit" });
  // Wait for the primary content marker, then for the network to settle.
  let readyMs = Number.NaN;
  try {
    await page.waitForSelector(route.ready, { timeout: 12000, state: "visible" });
    readyMs = Date.now() - t0;
  } catch {
    readyMs = Date.now() - t0; // record elapsed even if selector never showed
  }
  // The app holds open wss/long-poll connections, so "networkidle" never
  // fires. Use the load event (capped) as the settle proxy instead.
  try {
    await page.waitForLoadState("load", { timeout: 8000 });
  } catch {
    // ignore
  }
  const settledMs = Date.now() - t0;

  const nav = await page.evaluate(() => {
    const [n] = performance.getEntriesByType("navigation");
    const paints = performance.getEntriesByType("paint");
    const fcp = paints.find((p) => p.name === "first-contentful-paint");
    return {
      ttfb: n ? n.responseStart - n.requestStart : null,
      domcl: n ? n.domContentLoadedEventEnd - n.startTime : null,
      load: n ? n.loadEventEnd - n.startTime : null,
      fcp: fcp ? fcp.startTime : null,
      status: n ? n.responseStatus : null,
      finalUrl: location.pathname,
    };
  });

  return { ...nav, ready: readyMs, settled: settledMs };
}

async function main() {
  if (!COOKIES) {
    console.error("Missing --cookies (session cookie string)");
    process.exit(2);
  }
  const host = new URL(BASE).hostname;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(parseCookies(COOKIES, host));
  const page = await context.newPage();

  const out = [];
  for (const route of ROUTES) {
    for (let i = 0; i < WARMUP; i++) {
      try {
        await measure(page, route);
      } catch {}
    }
    const samples = [];
    let last = null;
    for (let i = 0; i < ITERS; i++) {
      try {
        last = await measure(page, route);
        samples.push(last);
      } catch (e) {
        // record failure but keep going
      }
    }
    const pick = (key) => samples.map((s) => s[key]).filter((v) => typeof v === "number").sort((a, b) => a - b);
    out.push({
      path: route.path,
      status: last?.status ?? null,
      finalUrl: last?.finalUrl ?? null,
      n: samples.length,
      ttfb: pct(pick("ttfb"), 50),
      fcp: pct(pick("fcp"), 50),
      domcl: pct(pick("domcl"), 50),
      load: pct(pick("load"), 50),
      ready_p50: pct(pick("ready"), 50),
      ready_p90: pct(pick("ready"), 90),
      settled_p50: pct(pick("settled"), 50),
    });
  }

  await browser.close();

  const pad = (s, n) => String(s ?? "").padEnd(n);
  console.log(`\n=== Authenticated page load (ms, browser) — base=${BASE} iters=${ITERS} ===`);
  console.log(
    `${pad("route", 30)}${pad("status", 7)}${pad("ttfb", 7)}${pad("fcp", 7)}${pad("domcl", 7)}${pad("load", 8)}${pad("ready50", 9)}${pad("ready90", 9)}${pad("settled", 9)}`,
  );
  out.sort((a, b) => (b.ready_p50 || 0) - (a.ready_p50 || 0));
  for (const r of out) {
    const mark = (r.ready_p50 ?? Infinity) > 50 ? "  <-- >50ms" : "";
    console.log(
      `${pad(r.path, 30)}${pad(r.status, 7)}${pad(r.ttfb, 7)}${pad(r.fcp, 7)}${pad(r.domcl, 7)}${pad(r.load, 8)}${pad(r.ready_p50, 9)}${pad(r.ready_p90, 9)}${pad(r.settled_p50, 9)}${mark}`,
    );
  }
  const over = out.filter((r) => (r.ready_p50 ?? Infinity) > 50);
  console.log(`\n${out.length} routes; ${over.length} over 50ms on "ready" (content visible).`);
  console.log(`Columns: ttfb=server doc, fcp=first paint, ready=content-visible, settled=networkidle. Medians.`);

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, iters: ITERS, results: out }, null, 2));
    console.log(`Wrote ${JSON_OUT}`);
  }
}

main();
