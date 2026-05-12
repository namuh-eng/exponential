import TeamWorkflowsSettingsPage from "@/app/(app)/settings/teams/[key]/workflows/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "TEAM" }),
}));

const mockTeam = {
  name: "Team Name",
  detailedHistory: false,
};

describe("TeamWorkflowsSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options) => {
        if (url === "/api/teams/TEAM/settings" && !options) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ team: mockTeam }),
          });
        }
        if (url === "/api/teams/TEAM/settings" && options?.method === "PATCH") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                team: { ...mockTeam, ...JSON.parse(options.body) },
              }),
          });
        }
        return Promise.reject(new Error("Unhandled fetch"));
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders loading state then workflows settings", async () => {
    render(<TeamWorkflowsSettingsPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Workflows & automations")).toBeInTheDocument();
    });

    expect(
      screen.getByLabelText("Enable detailed issue history"),
    ).toBeInTheDocument();
  });

  it("handles toggling detailed history and saving", async () => {
    render(<TeamWorkflowsSettingsPage />);
    await waitFor(() => screen.getByLabelText("Enable detailed issue history"));

    const toggle = screen.getByLabelText("Enable detailed issue history");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText("Workflow settings updated")).toBeInTheDocument();
    });

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/teams/TEAM/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ detailedHistory: true }),
      }),
    );
  });

  it("shows error message when save fails", async () => {
    vi.mocked(global.fetch).mockImplementation((url, options) => {
      if (url === "/api/teams/TEAM/settings" && options?.method === "PATCH") {
        return Promise.resolve({ ok: false } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ team: mockTeam }),
      } as Response);
    });

    render(<TeamWorkflowsSettingsPage />);
    await waitFor(() => screen.getByLabelText("Enable detailed issue history"));

    fireEvent.click(screen.getByLabelText("Enable detailed issue history"));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to update workflow settings"),
      ).toBeInTheDocument();
    });
  });

  it("shows team not found when API returns null team", async () => {
    vi.mocked(global.fetch).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ team: null }),
      } as Response),
    );

    render(<TeamWorkflowsSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Team not found")).toBeInTheDocument();
    });
  });
});
