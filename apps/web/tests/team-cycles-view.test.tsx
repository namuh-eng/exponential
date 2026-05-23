import TeamCyclesSettingsPage from "@/app/(app)/settings/teams/[key]/cycles/page";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "TEAM" }),
}));

const mockCyclesResponse = {
  team: {
    name: "Team Name",
    cyclesEnabled: true,
  },
  cycles: [
    {
      id: "c1",
      name: "Custom Cycle",
      number: 1,
      startDate: "2024-01-01",
      endDate: "2024-01-14",
      issueCount: 10,
      completedIssueCount: 5,
    },
    {
      id: "c2",
      name: null,
      number: 2,
      startDate: "2024-01-15",
      endDate: "2024-01-28",
      issueCount: 2,
      completedIssueCount: 0,
    },
  ],
};

describe("TeamCyclesSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockCyclesResponse),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders loading state then cycles list", async () => {
    render(<TeamCyclesSettingsPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Cycles")).toBeInTheDocument();
    });

    expect(screen.getByText("Custom Cycle")).toBeInTheDocument();
    expect(screen.getByText("Cycle 2")).toBeInTheDocument();
    expect(screen.getByText("10 issues")).toBeInTheDocument();
    expect(screen.getByText("5 completed")).toBeInTheDocument();
  });

  it("shows disabled warning when cyclesEnabled is false", async () => {
    vi.mocked(global.fetch).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockCyclesResponse,
            team: { ...mockCyclesResponse.team, cyclesEnabled: false },
          }),
      } as Response),
    );

    render(<TeamCyclesSettingsPage />);
    await waitFor(() => {
      expect(
        screen.getByText(/Cycles are currently disabled/),
      ).toBeInTheDocument();
    });
  });

  it("shows empty state when no cycles exist", async () => {
    vi.mocked(global.fetch).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockCyclesResponse,
            cycles: [],
          }),
      } as Response),
    );

    render(<TeamCyclesSettingsPage />);
    await waitFor(() => {
      expect(
        screen.getByText("No cycles have been created for this team."),
      ).toBeInTheDocument();
    });
  });

  it("shows team not found when API returns null data", async () => {
    vi.mocked(global.fetch).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(null),
      } as Response),
    );

    render(<TeamCyclesSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Team not found")).toBeInTheDocument();
    });
  });
});
