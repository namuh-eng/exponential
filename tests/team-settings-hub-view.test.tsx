import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamSettingsHubPage from "../src/app/(app)/settings/teams/[key]/page";

// Mock useParams and useRouter
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("TeamSettingsHubPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const mockTeamData = {
    team: {
      name: "Engineering",
      key: "ENG",
      icon: "🚀",
      memberCount: 5,
      labelCount: 10,
      statusCount: 6,
      triageEnabled: true,
      cyclesEnabled: false,
    },
  };

  it("renders loading state then team settings hub", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockTeamData,
    });

    render(<TeamSettingsHubPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Engineering")).toBeDefined();
    });

    expect(screen.getByText("🚀")).toBeDefined();
    expect(screen.getByText("5 members")).toBeDefined();
    expect(screen.getByText("10 labels")).toBeDefined();
    expect(screen.getByText("6 statuses")).toBeDefined();
    expect(screen.getByText("Enabled")).toBeDefined(); // Triage
    expect(screen.getByText("Off")).toBeDefined(); // Cycles
  });

  it("handles team deletion flow", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              redirectTo: "/settings",
              message: "Engineering was deleted.",
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockTeamData,
        });
      },
    );

    render(<TeamSettingsHubPage />);
    await waitFor(() => screen.getByText("Engineering"));

    fireEvent.click(screen.getByText("Delete team"));

    expect(screen.getByText("Delete team?")).toBeDefined();
    expect(
      screen.getByText(
        /Deleting a team permanently removes its team-scoped data/i,
      ),
    ).toBeDefined();

    const deleteButton = screen.getAllByRole("button", {
      name: "Delete team",
    })[1];
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/teams/ENG/settings",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "delete" }),
        }),
      );
      expect(screen.getByText("Engineering was deleted.")).toBeDefined();
    });
  });

  it("handles leave team flow", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              redirectTo: "/settings",
              message: "Left Engineering.",
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockTeamData,
        });
      },
    );

    render(<TeamSettingsHubPage />);
    await waitFor(() => screen.getByText("Engineering"));

    fireEvent.click(screen.getByText("Leave team"));

    expect(screen.getByText("Leave team?")).toBeDefined();

    const confirmButton = screen.getAllByRole("button", {
      name: "Leave team",
    })[1];
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/teams/ENG/settings",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "leave" }),
        }),
      );
      expect(screen.getByText("Left Engineering.")).toBeDefined();
    });
  });

  it("shows team not found when team is missing", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ team: null }),
    });

    render(<TeamSettingsHubPage />);

    await waitFor(() => {
      expect(screen.getByText("Team not found")).toBeDefined();
    });
  });
});
