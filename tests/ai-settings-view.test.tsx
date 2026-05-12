import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AISettingsPage from "../src/app/(app)/settings/ai/page";

describe("AISettingsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const mockAnalyticsData = {
    workspaceId: "ws_1",
    completedLast30Days: [
      { teamId: "t1", teamName: "Engineering", completedCount: 15 },
      { teamId: "t2", teamName: "Product", completedCount: 5 },
    ],
    activeIssues: [
      { teamId: "t1", teamName: "Engineering", activeCount: 20 },
      { teamId: "t2", teamName: "Product", activeCount: 8 },
    ],
    period: "Last 30 days",
  };

  it("renders loading state initially", () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Promise(() => {}),
    );
    render(<AISettingsPage />);
    expect(screen.getByText("Loading...")).toBeDefined();
  });

  it("renders analytics data and team summary cards", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockAnalyticsData,
    });

    render(<AISettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("20").length).toBeGreaterThan(0); // Total completed: 15+5
    });

    expect(screen.getByText("28")).toBeDefined(); // Total active: 20+8
    expect(screen.getByText("Engineering")).toBeDefined();
    expect(screen.getByText("Product")).toBeDefined();
    expect(screen.getAllByText("20").length).toBeGreaterThanOrEqual(2); // One in StatCard, one in table
    expect(screen.getAllByText("15")).toHaveLength(1); // In table
  });

  it("shows error message when fetch fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
    });

    render(<AISettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Unable to load workspace analytics."),
      ).toBeDefined();
    });
  });

  it("shows empty state in table when no active issues", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockAnalyticsData,
        activeIssues: [],
        completedLast30Days: [],
      }),
    });

    render(<AISettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("No team activity found.")).toBeDefined();
    });
  });
});
