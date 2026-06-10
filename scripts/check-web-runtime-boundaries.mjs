#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = "apps/web/src";
const forbiddenImports = [
  {
    pattern:
      /from\s+["'](?:@better-auth\/passkey|better-auth(?:\/[^"']*)?)["']/,
    label: "Better Auth",
  },
  {
    pattern: /from\s+["']drizzle-orm(?:\/[^"']*)?["']/,
    label: "Drizzle",
  },
  {
    pattern: /from\s+["']@\/lib\/db(?:\/[^"']*)?["']/,
    label: "web-owned database access",
  },
  {
    pattern: /from\s+["']@\/lib\/auth["']/,
    label: "web-owned server auth",
  },
  {
    pattern: /from\s+["']@\/lib\/api-auth["']/,
    label: "web-owned API auth",
  },
];

const failures = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      continue;
    }
    const source = readFileSync(fullPath, "utf8");
    for (const rule of forbiddenImports) {
      if (rule.pattern.test(source)) {
        failures.push(`${fullPath}: imports ${rule.label}`);
      }
    }
  }
}

walk(root);

if (failures.length > 0) {
  console.error(
    "apps/web/src must stay UI-only. Move auth, billing, and DB work to apps/api.",
  );
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Web runtime boundary guard passed.");
