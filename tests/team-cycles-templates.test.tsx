import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import TeamCyclesSettingsPage from "@/app/(app)/settings/teams/[key]/cycles/page";
import TeamSlackSettingsPage from "@/app/(app)/settings/teams/[key]/slack-notifications/page";
import TeamTemplatesSettingsPage from "@/app/(app)/settings/teams/[key]/templates/page";
import { useParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
  useLink: vi.fn(),
}));

describe("Team Cycles & Templates Settings", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockCyclesData = {
    team: { name: "Engineering", cyclesEnabled: true },
    cycles: [
      {
        id: "c-1",
        name: "Sprint 1",
        number: 1,
        startDate: "2026-04-20T00:00:00Z",
        endDate: "2026-05-03T23:59:59Z",
        issueCount: 5,
        completedIssueCount: 2,
      },
    ],
  };

  const mockTemplatesData = {
    team: { name: "Engineering" },
    templates: [
      { id: "temp-1", name: "Bug Report", description: "Standard bug report" },
    ],
  };

  it("renders team slack settings correctly", () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });
    render(<TeamSlackSettingsPage />);

    expect(screen.getByText("Slack notifications")).toBeInTheDocument();
    expect(screen.getByText("Slack is not connected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect Slack" }),
    ).toBeInTheDocument();
  });

  it("renders team cycles settings with data", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCyclesData),
      }),
    );

    render(<TeamCyclesSettingsPage />);

    await waitFor(() => expect(screen.getByText("Cycles")).toBeInTheDocument());
    expect(screen.getByText("Sprint 1")).toBeInTheDocument();
    expect(screen.getByText("5 issues")).toBeInTheDocument();
    expect(screen.getByText("2 completed")).toBeInTheDocument();
  });

  it("shows disabled warning when cycles are off", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockCyclesData,
            team: { ...mockCyclesData.team, cyclesEnabled: false },
          }),
      }),
    );

    render(<TeamCyclesSettingsPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/Cycles are currently disabled/),
      ).toBeInTheDocument(),
    );
  });

  it("renders team templates settings with data", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTemplatesData),
      }),
    );

    render(<TeamTemplatesSettingsPage />);

    await waitFor(() =>
      expect(screen.getByText("Templates")).toBeInTheDocument(),
    );
    expect(screen.getByText("Bug Report")).toBeInTheDocument();
    expect(screen.getByText("Standard bug report")).toBeInTheDocument();
  });
});
