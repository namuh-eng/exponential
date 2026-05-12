import TeamAgentsSettingsPage from "@/app/(app)/settings/teams/[key]/agents/page";
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
  agentGuidance: "Original Guidance",
  autoAssignment: false,
};

describe("TeamAgentsSettingsPage", () => {
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

  it("renders loading state then agent settings", async () => {
    render(<TeamAgentsSettingsPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Agents")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("Original Guidance")).toBeInTheDocument();
    expect(screen.getByLabelText("Enable auto-assignment")).toBeInTheDocument();
  });

  it("handles updating agent guidance on blur", async () => {
    render(<TeamAgentsSettingsPage />);
    await waitFor(() => screen.getByDisplayValue("Original Guidance"));

    const textarea = screen.getByDisplayValue("Original Guidance");
    fireEvent.change(textarea, { target: { value: "New Guidance" } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(screen.getByText("Agent settings updated")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/teams/TEAM/settings",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"agentGuidance":"New Guidance"'),
      }),
    );
  });

  it("handles toggling auto-assignment", async () => {
    render(<TeamAgentsSettingsPage />);
    await waitFor(() => screen.getByLabelText("Enable auto-assignment"));

    const toggle = screen.getByLabelText("Enable auto-assignment");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText("Agent settings updated")).toBeInTheDocument();
    });

    expect(toggle).toHaveAttribute("aria-checked", "true");
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

    render(<TeamAgentsSettingsPage />);
    await waitFor(() => screen.getByLabelText("Enable auto-assignment"));

    fireEvent.click(screen.getByLabelText("Enable auto-assignment"));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to update agent settings"),
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

    render(<TeamAgentsSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Team not found")).toBeInTheDocument();
    });
  });
});
