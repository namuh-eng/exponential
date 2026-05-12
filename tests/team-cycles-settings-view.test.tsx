import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamCyclesSettingsPage from "../src/app/(app)/settings/teams/[key]/cycles/page";

// Mock useParams
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
}));

describe("TeamCyclesSettingsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const mockCyclesData = {
    team: {
      name: "Engineering",
      cyclesEnabled: true,
    },
    cycles: [
      {
        id: "c1",
        name: "Sprint 1",
        number: 1,
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-01-14T00:00:00Z",
        issueCount: 10,
        completedIssueCount: 8,
      },
    ],
  };

  it("renders loading state then cycles", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockCyclesData,
    });

    render(<TeamCyclesSettingsPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Cycles")).toBeDefined();
    });

    expect(screen.getByText("Sprint 1")).toBeDefined();
    expect(screen.getByText("10 issues")).toBeDefined();
    expect(screen.getByText("8 completed")).toBeDefined();
  });

  it("shows disabled warning when cycles are disabled", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockCyclesData,
        team: { ...mockCyclesData.team, cyclesEnabled: false },
        cycles: [],
      }),
    });

    render(<TeamCyclesSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/Cycles are currently disabled for this team/i),
      ).toBeDefined();
    });
  });

  it("shows empty state when no cycles exist", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockCyclesData,
        cycles: [],
      }),
    });

    render(<TeamCyclesSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No cycles have been created for this team."),
      ).toBeDefined();
    });
  });
});
