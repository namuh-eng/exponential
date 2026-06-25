#!/usr/bin/env node
// Deep profile of a single authenticated route: capture the full network
// waterfall (every request, type, size, duration) plus navigation timing and
// long-task / hydration signals, for one cold navigation.
//
// Usage:
//   node scripts/perf-profile-route.mjs --base http://localhost:7015 \
//     --cookies "..." --path /foreverbrowsing/settings --json out.json

import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = flag("base", "http://localhost:7015");
const COOKIES = flag("cookies", "");
const PATH = flag("path", "/foreverbrowsing/settings");
const JSON_OUT = flag("json", null);

const parseCookies = (raw, host) =>
  raw.split(";").map((s) => s.trim()).filter(Boolean).map((pair) => {
    const eq = pair.indexOf("=");
    return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: host, path: "/" };
  });

async function main() {
  const host = new URL(BASE).hostname;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(parseCookies(COOKIES, host));
  const page = await context.newPage();

  const requests = [];
  page.on("requestfinished", async (req) => {
    try {
      const res = await req.response();
      const timing = req.timing();
      const sizes = await res?.request().sizes?.().catch(() => null);
      requests.push({
        url: req.url().replace(BASE, ""),
        type: req.resourceType(),
        status: res?.status(),
        ms: timing ? +(timing.responseEnd - timing.startTime).toFixed(1) : null,
        startMs: timing ? +timing.startTime.toFixed(1) : null,
        bytes: sizes?.responseBodySize ?? null,
      });
    } catch {}
  });

  const t0 = Date.now();
  await page.goto(BASE + PATH, { waitUntil: "commit" });
  try {
    await page.waitForSelector("main", { timeout: 12000, state: "visible" });
  } catch {}
  const readyMs = Date.now() - t0;
  try {
    await page.waitForLoadState("load", { timeout: 8000 });
  } catch {}

  const nav = await page.evaluate(() => {
    const [n] = performance.getEntriesByType("navigation");
    const paints = performance.getEntriesByType("paint");
    const fcp = paints.find((p) => p.name === "first-contentful-paint");
    const res = performance.getEntriesByType("resource").map((r) => ({
      name: r.name,
      type: r.initiatorType,
      dur: +r.duration.toFixed(1),
      start: +r.startTime.toFixed(1),
      size: r.transferSize,
      encoded: r.encodedBodySize,
    }));
    return {
      ttfb: n ? +(n.responseStart - n.requestStart).toFixed(1) : null,
      docDur: n ? +(n.responseEnd - n.startTime).toFixed(1) : null,
      domcl: n ? +(n.domContentLoadedEventEnd - n.startTime).toFixed(1) : null,
      load: n ? +(n.loadEventEnd - n.startTime).toFixed(1) : null,
      fcp: fcp ? +fcp.startTime.toFixed(1) : null,
      transferKB: +(res.reduce((a, r) => a + (r.size || 0), 0) / 1024).toFixed(1),
      resources: res,
    };
  });

  await browser.close();

  // Aggregate by type.
  const byType = {};
  for (const r of nav.resources) {
    const t = r.type || "other";
    byType[t] = byType[t] || { count: 0, kb: 0, ms: 0 };
    byType[t].count++;
    byType[t].kb += (r.size || 0) / 1024;
    byType[t].ms += r.dur;
  }

  console.log(`\n=== Profile ${PATH} ===`);
  console.log(`TTFB=${nav.ttfb}ms  FCP=${nav.fcp}ms  DOMContentLoaded=${nav.domcl}ms  load=${nav.load}ms  ready(main)=${readyMs}ms`);
  console.log(`Total resources: ${nav.resources.length}, transfer ~${nav.transferKB}KB\n`);
  console.log("By resource type:");
  for (const [t, v] of Object.entries(byType).sort((a, b) => b[1].kb - a[1].kb)) {
    console.log(`  ${t.padEnd(10)} count=${String(v.count).padEnd(4)} ${v.kb.toFixed(1)}KB  sumDur=${v.ms.toFixed(0)}ms`);
  }
  console.log("\nSlowest 15 requests (by duration):");
  for (const r of [...nav.resources].sort((a, b) => b.dur - a.dur).slice(0, 15)) {
    console.log(`  ${String(r.dur).padStart(7)}ms  start=${String(r.start).padStart(7)}  ${((r.size||0)/1024).toFixed(1).padStart(6)}KB  ${r.type.padEnd(8)} ${r.name.replace(BASE, "").slice(0, 80)}`);
  }
  console.log("\nFetch/XHR (client data) requests:");
  for (const r of nav.resources.filter((r) => r.type === "fetch" || r.type === "xmlhttprequest")) {
    console.log(`  ${String(r.dur).padStart(7)}ms  start=${String(r.start).padStart(7)}  ${r.name.replace(BASE, "").slice(0, 90)}`);
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ path: PATH, nav, requests }, null, 2));
    console.log(`\nWrote ${JSON_OUT}`);
  }
}

main();
