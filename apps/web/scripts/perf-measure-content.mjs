#!/usr/bin/env node
// Authenticated, browser-based CONTENT-visible measurement.
//
// Improves on perf-measure-auth.mjs: instead of waiting for `main` (which
// appears at shell hydration even while a page still shows "Loading..."),
// this waits until the page's primary content is actually rendered, defined
// as: <main> is present AND it no longer contains the "Loading..." sentinel
// that every data page renders while its client fetch is in flight.
//
// For RSC-seeded pages the sentinel is never emitted, so `content` resolves at
// first paint. For un-seeded (client-fetch) pages it resolves only after the
// post-hydration round-trip lands. That difference is exactly the win we want
// to measure honestly.
//
// Usage:
//   node scripts/perf-measure-content.mjs --base http://localhost:7015 \
//     --cookies "exponential_session=...; activeWorkspaceId=...; activeWorkspaceSlug=..." \
//     --iters 8 --warmup 2 --json out.json

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

const ROUTES = [
  { path: "/" },
  { path: `/${SLUG}/inbox` },
  { path: `/${SLUG}/my-issues/assigned` },
  { path: `/${SLUG}/team/ENG/all` },
  { path: `/${SLUG}/team/ENG/board` },
  { path: `/${SLUG}/team/ENG/active` },
  { path: `/${SLUG}/projects` },
  { path: `/${SLUG}/initiatives` },
  { path: `/${SLUG}/roadmap` },
  { path: `/${SLUG}/cycles` },
  { path: `/${SLUG}/search` },
  { path: `/${SLUG}/settings` },
  { path: `/${SLUG}/settings/members` },
];

function pct(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
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
  let contentMs = Number.NaN;
  try {
    // main present AND no "Loading..." sentinel text inside it.
    await page.waitForFunction(
      () => {
        const m = document.querySelector("main");
        if (!m) return false;
        const txt = m.textContent || "";
        return !txt.includes("Loading...");
      },
      { timeout: 12000 },
    );
    contentMs = Date.now() - t0;
  } catch {
    contentMs = Date.now() - t0;
  }
  try {
    await page.waitForLoadState("load", { timeout: 8000 });
  } catch {}
  const settledMs = Date.now() - t0;

  const nav = await page.evaluate(() => {
    const [n] = performance.getEntriesByType("navigation");
    const paints = performance.getEntriesByType("paint");
    const fcp = paints.find((p) => p.name === "first-contentful-paint");
    return {
      ttfb: n ? n.responseStart - n.requestStart : null,
      fcp: fcp ? fcp.startTime : null,
      status: n ? n.responseStatus : null,
      finalUrl: location.pathname,
    };
  });

  return { ...nav, content: contentMs, settled: settledMs };
}

async function main() {
  if (!COOKIES) {
    console.error("Missing --cookies");
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
      } catch {}
    }
    const pick = (key) =>
      samples
        .map((s) => s[key])
        .filter((v) => typeof v === "number")
        .sort((a, b) => a - b);
    out.push({
      path: route.path,
      status: last?.status ?? null,
      finalUrl: last?.finalUrl ?? null,
      n: samples.length,
      ttfb: pct(pick("ttfb"), 50),
      fcp: pct(pick("fcp"), 50),
      content_p50: pct(pick("content"), 50),
      content_p90: pct(pick("content"), 90),
      settled_p50: pct(pick("settled"), 50),
    });
  }

  await browser.close();

  const pad = (s, n) => String(s ?? "").padEnd(n);
  console.log(
    `\n=== Authenticated CONTENT-visible (ms, browser) — base=${BASE} iters=${ITERS} ===`,
  );
  console.log(
    `${pad("route", 32)}${pad("status", 7)}${pad("ttfb", 7)}${pad("fcp", 7)}${pad("content50", 11)}${pad("content90", 11)}${pad("settled", 9)}`,
  );
  out.sort((a, b) => (b.content_p50 || 0) - (a.content_p50 || 0));
  for (const r of out) {
    const mark =
      (r.content_p50 ?? Number.POSITIVE_INFINITY) > 50 ? "  <-- >50ms" : "";
    console.log(
      `${pad(r.path, 32)}${pad(r.status, 7)}${pad(r.ttfb, 7)}${pad(r.fcp, 7)}${pad(r.content_p50, 11)}${pad(r.content_p90, 11)}${pad(r.settled_p50, 9)}${mark}`,
    );
  }
  const over = out.filter(
    (r) => (r.content_p50 ?? Number.POSITIVE_INFINITY) > 50,
  );
  console.log(
    `\n${out.length} routes; ${over.length} over 50ms on content-visible.`,
  );
  console.log(
    `content = <main> present AND no "Loading..." sentinel. Medians.`,
  );

  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify({ base: BASE, iters: ITERS, results: out }, null, 2),
    );
    console.log(`Wrote ${JSON_OUT}`);
  }
}

main();
