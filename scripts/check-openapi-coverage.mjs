#!/usr/bin/env node
import fs from "node:fs";

const openapi = fs.readFileSync("packages/proto/openapi.yaml", "utf8");
const routerFiles = ["apps/api/internal/http/router.go"];
const mountedRoutes = new Set();
const nonContractProxyMounts = new Set(["/scim/v2"]);
const nonContractProviderCallbacks = new Set([
  // Inbound Stripe provider callback. This route is not a client/business API
  // surface and must not appear in the generated public SDK.
  "/stripe/webhook",
  // Slack provider callbacks are invoked by Slack, not by public API clients.
  "/integrations/slack/oauth/callback",
  "/integrations/slack/events",
  "/integrations/slack/interactivity",
  "/integrations/discord/oauth/callback",
  "/integrations/discord/interactions",
  "/integrations/microsoft-teams/oauth/callback",
  "/integrations/microsoft-teams/activities",
  "/integrations/gong/oauth/callback",
]);

for (const file of routerFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/Mount\("([^"]+)"/g)) {
    const mount = match[1];
    if (nonContractProxyMounts.has(mount)) {
      continue;
    }
    mountedRoutes.add(`/v1${mount}`);
  }
  for (const match of source.matchAll(
    /\.(?:Get|Post|Patch|Delete|Put)\("([^"]+)"/g,
  )) {
    const path = match[1];
    if (nonContractProviderCallbacks.has(path)) {
      continue;
    }
    if (path.startsWith("/sync/")) {
      mountedRoutes.add(`/v1${path}`);
    }
  }
}

const required = [...mountedRoutes];
const missing = required.filter((route) => {
  const specPath = route.replace(/^\/v1/, "");
  return !openapi.includes(`${specPath}:`);
});

if (missing.length > 0) {
  console.error("OpenAPI is missing implemented Go routes:");
  for (const route of missing) {
    console.error(`- ${route}`);
  }
  process.exit(1);
}

console.log(
  `OpenAPI coverage passed for ${required.length} Go route mount(s).`,
);
