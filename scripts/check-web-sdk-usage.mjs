#!/usr/bin/env node
import { readFileSync } from "node:fs";

const browserClient = readFileSync(
  "apps/web/src/lib/browser-api-client.ts",
  "utf8",
);
if (!browserClient.includes('from "@exponential/sdk"')) {
  throw new Error("apps/web browser API client must use @exponential/sdk");
}
if (
  !browserClient.includes("baseUrl: browserApiBaseUrl()") ||
  !browserClient.includes('new URL("/api", window.location.origin)')
) {
  throw new Error(
    "apps/web browser API client must target the same-origin /api prefix",
  );
}

const agentDashboard = readFileSync(
  "apps/web/src/components/agent-dashboard.tsx",
  "utf8",
);
if (!agentDashboard.includes("createBrowserApiClient")) {
  throw new Error(
    "AgentDashboard must consume the generated SDK browser client",
  );
}
for (const forbidden of [
  'fetch("/api/agent/runs"',
  "fetch('/api/agent/runs'",
  "`/api/agent/runs/",
]) {
  if (agentDashboard.includes(forbidden)) {
    throw new Error(
      `AgentDashboard still contains direct agent API fetch: ${forbidden}`,
    );
  }
}

const createWorkspacePage = readFileSync(
  "apps/web/src/app/create-workspace/page.tsx",
  "utf8",
);
if (!createWorkspacePage.includes("createBrowserApiClient")) {
  throw new Error(
    "CreateWorkspacePage must consume the generated SDK browser client",
  );
}
for (const forbidden of [
  'fetch("/api/workspaces"',
  "fetch('/api/workspaces'",
]) {
  if (createWorkspacePage.includes(forbidden)) {
    throw new Error(
      `CreateWorkspacePage still contains direct workspace API fetch: ${forbidden}`,
    );
  }
}

const projectStatusesPage = readFileSync(
  "apps/web/src/app/(app)/settings/project-statuses/page.tsx",
  "utf8",
);
if (!projectStatusesPage.includes("createBrowserApiClient")) {
  throw new Error(
    "ProjectStatusesPage must consume the generated SDK browser client",
  );
}
for (const forbidden of [
  'fetch("/api/project-statuses"',
  "fetch('/api/project-statuses'",
]) {
  if (projectStatusesPage.includes(forbidden)) {
    throw new Error(
      `ProjectStatusesPage still contains direct project statuses API fetch: ${forbidden}`,
    );
  }
}

const workspaceTeamsDirectory = readFileSync(
  "apps/web/src/components/workspace-teams-directory.tsx",
  "utf8",
);
if (!workspaceTeamsDirectory.includes("createBrowserApiClient")) {
  throw new Error(
    "WorkspaceTeamsDirectory must consume the generated SDK browser client",
  );
}
for (const forbidden of ['fetch("/api/teams"', "fetch('/api/teams'"]) {
  if (workspaceTeamsDirectory.includes(forbidden)) {
    throw new Error(
      `WorkspaceTeamsDirectory still contains direct teams API fetch: ${forbidden}`,
    );
  }
}

const onboardingInvitePage = readFileSync(
  "apps/web/src/app/onboarding/invite/page.tsx",
  "utf8",
);
if (!onboardingInvitePage.includes("createBrowserApiClient")) {
  throw new Error(
    "OnboardingInvitePage must consume the generated SDK browser client",
  );
}
for (const forbidden of [
  'fetch("/api/workspaces/invite"',
  "fetch('/api/workspaces/invite'",
]) {
  if (onboardingInvitePage.includes(forbidden)) {
    throw new Error(
      `OnboardingInvitePage still contains direct workspace invite API fetch: ${forbidden}`,
    );
  }
}

console.log("Web runtime SDK usage guard passed.");
