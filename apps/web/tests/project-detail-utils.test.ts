import {
  buildMilestoneData,
  haveSameIds,
  readProjectSettings,
} from "@/lib/project-detail";
import { describe, expect, it } from "vitest";

describe("buildMilestoneData", () => {
  it("calculates progress per milestone instead of reusing all project issues", () => {
    const milestones = [
      { id: "milestone-a", name: "Tier 1" },
      { id: "milestone-b", name: "Tier 2" },
    ];
    const issues = [
      {
        id: "issue-1",
        projectMilestoneId: "milestone-a",
        completedAt: "2026-04-07T00:00:00.000Z",
      },
      {
        id: "issue-2",
        projectMilestoneId: "milestone-a",
        completedAt: null,
      },
      {
        id: "issue-3",
        projectMilestoneId: "milestone-b",
        completedAt: null,
      },
    ];

    expect(buildMilestoneData(milestones, issues)).toEqual([
      {
        id: "milestone-a",
        name: "Tier 1",
        issueCount: 2,
        completedCount: 1,
        progress: 50,
      },
      {
        id: "milestone-b",
        name: "Tier 2",
        issueCount: 1,
        completedCount: 0,
        progress: 0,
      },
    ]);
  });
});

describe("readProjectSettings", () => {
  it("normalizes invalid settings values", () => {
    expect(readProjectSettings({ labelIds: "bad", resources: null })).toEqual({
      slackChannel: null,
      labelIds: [],
      projectStatusKey: null,
      resources: [],
      activity: [],
      milestoneDescriptions: {},
    });
  });

  it("keeps valid stored resources and activity entries", () => {
    const parsed = readProjectSettings({
      slackChannel: "#proj",
      labelIds: ["label-1"],
      resources: [
        {
          id: "resource-1",
          title: "Spec",
          type: "link",
          url: "https://example.com/spec",
          createdAt: "2026-04-07T00:00:00.000Z",
        },
      ],
      milestoneDescriptions: { "milestone-1": "Scope" },
      activity: [
        {
          id: "entry-1",
          type: "update",
          title: "Project update",
          body: "Shipped the sidebar.",
          actorName: "Jaeyun Ha",
          actorImage: null,
          createdAt: "2026-04-07T00:00:00.000Z",
        },
      ],
    });

    expect(parsed.slackChannel).toBe("#proj");
    expect(parsed.labelIds).toEqual(["label-1"]);
    expect(parsed.resources).toHaveLength(1);
    expect(parsed.activity).toHaveLength(1);
    expect(parsed.milestoneDescriptions).toEqual({ "milestone-1": "Scope" });
  });
});

describe("haveSameIds", () => {
  it("treats reordered ids as unchanged", () => {
    expect(haveSameIds(["b", "a"], ["a", "b"])).toBe(true);
  });

  it("detects added or removed ids", () => {
    expect(haveSameIds(["a"], ["a", "b"])).toBe(false);
    expect(haveSameIds(["a", "c"], ["a", "b"])).toBe(false);
  });
});
