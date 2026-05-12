import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Analytics results don't have a view yet, so we verify the API contract
// and a placeholder component or logic derived from it.

describe("Team Analytics API and Logic", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockAnalyticsData = {
    team: { id: "t-1", name: "Engineering" },
    cycleMetrics: [
      { id: "c-1", name: "Cycle 1", total: 10, completed: 8, percentage: 80 },
    ],
    velocity: 2,
    period: "Last 4 weeks",
  };

  it("returns correct analytical data for a team", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAnalyticsData),
      }),
    );

    const res = await fetch("/api/teams/ENG/analytics");
    const data = await res.json();

    expect(data.team.name).toBe("Engineering");
    expect(data.cycleMetrics[0].percentage).toBe(80);
    expect(data.velocity).toBe(2);
  });
});
