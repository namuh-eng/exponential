import {
  generateTeamKey,
  getDefaultWorkflowStates,
  sanitizeWorkspaceSlug,
  validateWorkspaceName,
} from "@/lib/workspace-creation";
import { describe, expect, it } from "vitest";

describe("workspace creation helpers", () => {
  it("validates overly long workspace names before the database write", () => {
    expect(validateWorkspaceName("A".repeat(256))).toBe(
      "Workspace name must be 255 characters or fewer",
    );
  });

  it("allows workspace names up to the database limit", () => {
    expect(validateWorkspaceName("A".repeat(255))).toBeNull();
  });

  it("sanitizes and truncates workspace slugs to 63 characters", () => {
    expect(sanitizeWorkspaceSlug("Workspace ".repeat(10))).toBe(
      "workspace-workspace-workspace-workspace-workspace-workspace-wor",
    );
  });

  it("derives a team key prefix from the workspace name", () => {
    expect(generateTeamKey("QA Workspace", [])).toBe("QAX");
    expect(generateTeamKey("A", [])).toBe("AXX");
    expect(generateTeamKey("123 team", [])).toBe("XXX");
  });

  it("appends a numeric suffix when the default team key already exists", () => {
    expect(generateTeamKey("QA Workspace", ["QAX"])).toBe("QAX2");
    expect(generateTeamKey("QA Workspace", ["QAX", "QAX2"])).toBe("QAX3");
  });

  it("assigns sequential default workflow positions for new teams", () => {
    expect(getDefaultWorkflowStates("team-1")).toEqual([
      {
        category: "triage",
        color: "#f59e0b",
        isDefault: true,
        name: "Triage",
        position: 0,
        teamId: "team-1",
      },
      {
        category: "backlog",
        color: "#6b6f76",
        isDefault: true,
        name: "Backlog",
        position: 1,
        teamId: "team-1",
      },
      {
        category: "unstarted",
        color: "#6b6f76",
        isDefault: true,
        name: "Todo",
        position: 2,
        teamId: "team-1",
      },
      {
        category: "started",
        color: "#f59e0b",
        isDefault: true,
        name: "In Progress",
        position: 3,
        teamId: "team-1",
      },
      {
        category: "completed",
        color: "#22c55e",
        isDefault: true,
        name: "Done",
        position: 4,
        teamId: "team-1",
      },
      {
        category: "canceled",
        color: "#6b6f76",
        isDefault: true,
        name: "Canceled",
        position: 5,
        teamId: "team-1",
      },
    ]);
  });
});
