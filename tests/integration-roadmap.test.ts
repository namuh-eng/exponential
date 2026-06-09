import {
  INTEGRATION_ROADMAP_PHASES,
  LINEAR_INTEGRATION_ROADMAP,
  getIntegrationRoadmapSummary,
} from "@/lib/integration-roadmap";
import { INTEGRATION_CATALOG } from "@/lib/workspace-integrations";
import { describe, expect, it } from "vitest";

const expectedProviderBacklog = [
  "github",
  "slack",
  "webhooks",
  "customer-requests",
  "zendesk",
  "intercom",
  "front",
  "jira",
  "gitlab",
  "sentry",
  "figma",
  "microsoft-teams",
  "discord",
  "salesforce",
  "gong",
  "google-sheets",
  "airbyte",
  "zapier",
  "mcp",
  "ai-agents",
  "notion",
];

const requiredPlanningFields = [
  "setup",
  "dataModel",
  "runtime",
  "permissions",
  "adminUx",
] as const;

describe("Linear integration parity roadmap", () => {
  it("keeps the P0-P3 build order explicit and stable", () => {
    expect(INTEGRATION_ROADMAP_PHASES.map((phase) => phase.priority)).toEqual([
      "P0",
      "P1",
      "P2",
      "P3",
    ]);

    for (const phase of INTEGRATION_ROADMAP_PHASES) {
      expect(phase.items.length).toBeGreaterThan(0);
      expect(phase.items.map((item) => item.buildOrder)).toEqual(
        [...phase.items]
          .map((item) => item.buildOrder)
          .sort((left, right) => left - right),
      );
    }

    expect(INTEGRATION_ROADMAP_PHASES[0].items.map((item) => item.id)).toEqual([
      "integration-platform",
      "github-app-install",
      "github-pr-commit-automation",
      "slack-install-events",
      "slack-asks-issue-creation",
      "outbound-webhooks",
    ]);
  });

  it("covers every Linear integration category from the parent issue", () => {
    const coveredProviders = new Set(
      LINEAR_INTEGRATION_ROADMAP.flatMap((item) =>
        item.provider ? [item.provider] : [],
      ),
    );

    for (const provider of expectedProviderBacklog) {
      expect(coveredProviders.has(provider), provider).toBe(true);
    }

    expect(
      LINEAR_INTEGRATION_ROADMAP.some(
        (item) =>
          item.id === "third-party-directory" &&
          item.status === "parent_tracking",
      ),
    ).toBe(true);
  });

  it("requires every build issue to include implementation and validation ownership", () => {
    const buildIssues = LINEAR_INTEGRATION_ROADMAP.filter(
      (item) => item.status === "build_issue",
    );

    expect(buildIssues.length).toBeGreaterThan(20);
    for (const item of buildIssues) {
      expect(item.issue.number).toBeGreaterThan(0);
      expect(item.issue.url).toContain(`/issues/${item.issue.number}`);
      expect(item.parentIssue).toBe(592);
      expect(item.scope.trim().length).toBeGreaterThan(20);
      for (const field of requiredPlanningFields) {
        expect(
          item.planning[field].trim().length,
          `${item.id}:${field}`,
        ).toBeGreaterThan(10);
      }
      expect(item.acceptanceCriteria.length).toBeGreaterThanOrEqual(2);
      expect(item.validationPlan.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("exposes provider roadmap items through the integration catalog", () => {
    const catalogProviders = new Set(
      INTEGRATION_CATALOG.map((item) => item.provider),
    );
    for (const provider of expectedProviderBacklog) {
      expect(catalogProviders.has(provider), provider).toBe(true);
    }

    const summary = getIntegrationRoadmapSummary();
    expect(summary.parentIssue).toBe(592);
    expect(summary.totalItems).toBe(LINEAR_INTEGRATION_ROADMAP.length);
    expect(summary.buildIssues).toBeGreaterThan(20);
  });
});
