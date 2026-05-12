import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import TeamAnalyticsPage from "@/app/(app)/team/[key]/analytics/page";
import { useParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
}));

describe("TeamAnalyticsPage component", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockAnalyticsData = {
    team: { id: "t-1", name: "Engineering" },
    cycleMetrics: [
      { id: "c-1", name: "Sprint 1", total: 10, completed: 8, percentage: 80 },
      { id: "c-2", name: "Sprint 2", total: 5, completed: 5, percentage: 100 },
    ],
    velocity: 4,
    period: "Last 4 weeks",
  };

  it("renders analytics data and cycle progress bars", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAnalyticsData),
      }),
    );

    render(<TeamAnalyticsPage />);

    expect(screen.getByText("Loading analytics...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Engineering Analytics")).toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument(); // velocity
      expect(screen.getByText("Sprint 1")).toBeInTheDocument();
      expect(screen.getByText("8 / 10 (80%)")).toBeInTheDocument();
      expect(screen.getByText("Sprint 2")).toBeInTheDocument();
    });
  });

  it("shows empty state when no metrics are available", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "EMPTY" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            team: { id: "t-2", name: "Empty Team" },
            cycleMetrics: [],
            velocity: 0,
            period: "Last 4 weeks",
          }),
      }),
    );

    render(<TeamAnalyticsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No cycle data available for this team."),
      ).toBeInTheDocument();
    });
  });
});
