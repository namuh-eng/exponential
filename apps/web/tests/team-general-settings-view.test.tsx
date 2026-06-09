import TeamGeneralSettingsPage from "@/app/(app)/settings/teams/[key]/general/page";
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
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

const mockTeam = {
  name: "Team Name",
  key: "TEAM",
  icon: "🚀",
  timezone: "UTC",
  estimateType: "linear",
  emailEnabled: true,
  detailedHistory: true,
  cyclesEnabled: true,
  cycleStartDay: 1,
  cycleDurationWeeks: 2,
};

describe("TeamGeneralSettingsPage", () => {
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
          const body = JSON.parse(options.body);
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ team: { ...mockTeam, ...body } }),
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

  it("renders loading state then team general settings", async () => {
    render(<TeamGeneralSettingsPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("General")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("Team Name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("TEAM")).toBeInTheDocument();
  });

  it("handles basic field updates and saving", async () => {
    render(<TeamGeneralSettingsPage />);
    await waitFor(() => screen.getByDisplayValue("Team Name"));

    const nameInput = screen.getByDisplayValue("Team Name");
    fireEvent.change(nameInput, { target: { value: "Updated Team" } });

    const saveButton = screen.getByText("Save changes");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Changes saved")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/teams/TEAM/settings",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"name":"Updated Team"'),
      }),
    );
  });

  it("handles icon picker flow", async () => {
    render(<TeamGeneralSettingsPage />);
    await waitFor(() => screen.getByText("🚀"));

    const iconButton = screen.getByLabelText("Change team icon");
    fireEvent.click(iconButton);

    // Should show picker
    expect(screen.getByText("Choose an icon")).toBeInTheDocument();

    // Select new emoji
    const emojiButton = screen.getByLabelText("Choose ⚡ icon");
    fireEvent.click(emojiButton);

    // Picker should close and icon update
    expect(screen.queryByText("Choose an icon")).not.toBeInTheDocument();
    expect(screen.getByText("⚡")).toBeInTheDocument();
  });

  it("handles cycle settings toggling", async () => {
    render(<TeamGeneralSettingsPage />);
    await waitFor(() => screen.getByLabelText("Enable cycles"));

    const cyclesToggle = screen.getByLabelText("Enable cycles");
    const startDaySelect = screen.getByLabelText("Cycle start day");

    // Initially enabled in mockTeam
    expect(cyclesToggle).toHaveAttribute("aria-checked", "true");
    expect(startDaySelect).not.toBeDisabled();

    // Disable cycles
    fireEvent.click(cyclesToggle);
    expect(cyclesToggle).toHaveAttribute("aria-checked", "false");
    expect(startDaySelect).toBeDisabled();
  });

  it("shows error message when save fails", async () => {
    vi.mocked(global.fetch).mockImplementation((url, options) => {
      if (url === "/api/teams/TEAM/settings" && options?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Conflict on identifier" }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ team: mockTeam }),
      } as Response);
    });

    render(<TeamGeneralSettingsPage />);
    await waitFor(() => screen.getByText("Save changes"));

    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(screen.getByText("Conflict on identifier")).toBeInTheDocument();
    });
  });

  it("shows team not found when API returns error", async () => {
    vi.mocked(global.fetch).mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
      } as Response),
    );

    render(<TeamGeneralSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Team not found")).toBeInTheDocument();
    });
  });
});
