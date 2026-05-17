import { normalizeProjectTemplateSettings } from "@/lib/project-template-settings";
import { describe, expect, it } from "vitest";

describe("project template settings", () => {
  it("stores reusable defaults and structure for project creation", () => {
    const settings = normalizeProjectTemplateSettings({
      defaults: {
        status: "started",
        priority: "high",
        targetDateOffsetDays: 14,
      },
      milestones: [{ name: "Launch" }],
      starterIssues: [
        {
          title: "Draft launch plan",
          priority: "medium",
          milestoneName: "Launch",
        },
      ],
      metadata: { source: "regression" },
    });

    expect(settings.defaults.status).toBe("started");
    expect(settings.defaults.priority).toBe("high");
    expect(settings.defaults.targetDateOffsetDays).toBe(14);
    expect(settings.milestones).toEqual([{ name: "Launch", sortOrder: 0 }]);
    expect(settings.starterIssues[0]).toMatchObject({
      title: "Draft launch plan",
      priority: "medium",
      milestoneName: "Launch",
    });
  });

  it("normalizes invalid template values to safe project creation defaults", () => {
    const settings = normalizeProjectTemplateSettings({
      defaults: { status: "invalid", priority: "invalid" },
      milestones: [{ name: "" }, { name: "Valid" }],
      starterIssues: [
        { title: "" },
        { title: "Valid task", priority: "invalid" },
      ],
    });

    expect(settings.defaults.status).toBe("planned");
    expect(settings.defaults.priority).toBe("none");
    expect(settings.milestones).toHaveLength(1);
    expect(settings.starterIssues).toHaveLength(1);
    expect(settings.starterIssues[0].priority).toBe("none");
  });
});
