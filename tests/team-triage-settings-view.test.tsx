import TeamTriageSettingsPage from "@/app/(app)/settings/teams/[key]/triage/page";
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
  triageEnabled: true,
};

describe("TeamTriageSettingsPage", () => {
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

  it("renders loading state then triage settings", async () => {
    render(<TeamTriageSettingsPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Triage")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Enable triage")).toBeInTheDocument();
  });

  it("handles toggling triage and saving", async () => {
    render(<TeamTriageSettingsPage />);
    await waitFor(() => screen.getByLabelText("Enable triage"));

    const toggle = screen.getByLabelText("Enable triage");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText("Triage settings updated")).toBeInTheDocument();
    });

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/teams/TEAM/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ triageEnabled: false }),
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

    render(<TeamTriageSettingsPage />);
    await waitFor(() => screen.getByLabelText("Enable triage"));

    fireEvent.click(screen.getByLabelText("Enable triage"));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to update triage settings"),
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

    render(<TeamTriageSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Team not found")).toBeInTheDocument();
    });
  });
});
