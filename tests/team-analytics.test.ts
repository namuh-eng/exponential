import {
  buildAnalyticsResponse,
  normalizeAnalyticsQuery,
} from "@/lib/team-analytics";
import { describe, expect, it } from "vitest";

const now = new Date();
const daysAgo = (days: number) => {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date;
};

const issues = [
  {
    id: "i-1",
    identifier: "ENG-1",
    title: "Ship insights",
    estimate: 3,
    createdAt: daysAgo(10),
    completedAt: daysAgo(1),
    updatedAt: daysAgo(2),
    statusName: "Done",
    statusCategory: "completed",
    projectId: "p-1",
    projectName: "Analytics",
    cycleId: "c-1",
    cycleName: "Cycle 1",
    cycleNumber: 1,
    labels: ["reporting"],
  },
  {
    id: "i-2",
    identifier: "ENG-2",
    title: "Segment chart",
    estimate: 5,
    createdAt: daysAgo(20),
    completedAt: null,
    updatedAt: daysAgo(4),
    statusName: "In Progress",
    statusCategory: "started",
    projectId: "p-1",
    projectName: "Analytics",
    cycleId: "c-1",
    cycleName: "Cycle 1",
    cycleNumber: 1,
    labels: ["reporting", "frontend"],
  },
  {
    id: "i-3",
    identifier: "ENG-3",
    title: "Old bug",
    estimate: 1,
    createdAt: daysAgo(140),
    completedAt: daysAgo(130),
    updatedAt: daysAgo(130),
    statusName: "Done",
    statusCategory: "completed",
    projectId: null,
    projectName: null,
    cycleId: null,
    cycleName: null,
    cycleNumber: null,
    labels: ["bug"],
  },
];

describe("Team Analytics API and Logic", () => {
  it("normalizes parameterized analytics query controls", () => {
    const query = normalizeAnalyticsQuery(
      new URLSearchParams(
        "measure=effort&slice=project&segment=label&range=30d&status=completed&label=reporting",
      ),
    );

    expect(query).toMatchObject({
      measure: "effort",
      slice: "project",
      segment: "label",
      range: "30d",
      status: "completed",
      label: "reporting",
    });
  });

  it("builds chart, table, filter metadata, CSV/share actions, and cycle burndown data", () => {
    const response = buildAnalyticsResponse({
      team: { id: "t-1", key: "ENG", name: "Engineering" },
      query: normalizeAnalyticsQuery(
        new URLSearchParams(
          "measure=effort&slice=status&segment=project&range=90d&label=reporting",
        ),
      ),
      issues,
      cycles: [
        {
          id: "c-1",
          name: "Cycle 1",
          total: 2,
          completed: 1,
          startDate: daysAgo(14),
          endDate: daysAgo(1),
        },
      ],
    });

    expect(response.summary.issueCount).toBe(2);
    expect(response.summary.effort).toBe(8);
    expect(response.chart.title).toBe("Effort by Status");
    expect(response.tableRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "In Progress",
          segment: "Analytics",
          value: 5,
          count: 1,
        }),
        expect.objectContaining({
          label: "Done",
          segment: "Analytics",
          value: 3,
          completed: 1,
        }),
      ]),
    );
    expect(response.filters.labels).toEqual(
      expect.arrayContaining(["reporting", "frontend", "bug"]),
    );
    expect(response.actions.csv.enabled).toBe(true);
    expect(response.actions.share.enabled).toBe(true);
    expect(response.cycleMetrics[0]).toMatchObject({
      name: "Cycle 1",
      total: 2,
      completed: 1,
      percentage: 50,
    });
    expect(response.cycleMetrics[0].burndown[2]).toMatchObject({
      label: "Now",
      scope: 2,
      completed: 1,
    });
  });

  it("returns a meaningful empty state when filters remove all issues", () => {
    const response = buildAnalyticsResponse({
      team: { id: "t-1", key: "ENG", name: "Engineering" },
      query: normalizeAnalyticsQuery(
        new URLSearchParams("status=canceled&range=90d"),
      ),
      issues,
      cycles: [],
    });

    expect(response.tableRows).toHaveLength(0);
    expect(response.emptyState).toContain(
      "No issues match these analytics filters",
    );
  });
});
