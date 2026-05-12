import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Workspace Analytics API", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockWorkspaceAnalytics = {
    workspaceId: "ws-1",
    completedLast30Days: [
      { teamId: "t-1", teamName: "Engineering", completedCount: 25 },
      { teamId: "t-2", teamName: "Design", completedCount: 10 },
    ],
    activeIssues: [
      { teamId: "t-1", teamName: "Engineering", activeCount: 12 },
      { teamId: "t-2", teamName: "Design", activeCount: 5 },
    ],
    period: "Last 30 days",
  };

  it("fetches aggregated workspace data from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWorkspaceAnalytics),
      }),
    );

    const res = await fetch("/api/analytics/workspace");
    const data = await res.json();

    expect(data.workspaceId).toBe("ws-1");
    expect(data.completedLast30Days).toHaveLength(2);
    expect(data.completedLast30Days[0].completedCount).toBe(25);
    expect(data.activeIssues[1].activeCount).toBe(5);
  });
});
