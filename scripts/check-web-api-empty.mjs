#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const apiDir = "apps/web/src/app/api";
const routes = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (entry === "route.ts" || entry === "route.tsx") {
      routes.push(relative(apiDir, path));
    }
  }
}

if (existsSync(apiDir)) {
  walk(apiDir);
}

if (routes.length > 0) {
  console.error("Next.js API routes must stay empty; Go API owns /api:");
  for (const route of routes) {
    console.error(`- ${route}`);
  }
  process.exit(1);
}

console.log("Next.js API route directory is empty.");
