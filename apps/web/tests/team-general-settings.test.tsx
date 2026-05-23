import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useParams: () => ({ key: "ENG" }),
}));

// Mock timezones
vi.mock("@/lib/timezones", () => ({
  buildTimezoneOptions: () => [
    { value: "America/Los_Angeles", label: "Pacific Time" },
    { value: "Asia/Seoul", label: "Korea Standard Time" },
  ],
}));

import TeamGeneralSettingsPage from "@/app/(app)/settings/teams/[key]/general/page";

const mockTeamSettings = {
  team: {
    name: "Engineering",
    key: "ENG",
    icon: "🚀",
    timezone: "America/Los_Angeles",
    estimateType: "linear",
    emailEnabled: true,
    detailedHistory: false,
    cyclesEnabled: true,
    cycleStartDay: 1,
    cycleDurationWeeks: 2,
  },
};

describe("TeamGeneralSettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders loading state then team settings", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockTeamSettings,
    } as Response);

    render(<TeamGeneralSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByDisplayValue("Engineering")).toBeInTheDocument();
    expect(screen.getByText("🚀")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ENG")).toBeInTheDocument();
    expect(screen.getByLabelText("Timezone")).toHaveValue(
      "Pacific Time (America/Los_Angeles)",
    );
  });

  it("updates team name and saves changes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockTeamSettings,
    } as Response);

    render(<TeamGeneralSettingsPage />);
    await screen.findByDisplayValue("Engineering");

    fireEvent.change(screen.getByDisplayValue("Engineering"), {
      target: { value: "Eng Team" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/teams/ENG/settings",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"name":"Eng Team"'),
        }),
      );
      expect(screen.getByText("Changes saved")).toBeInTheDocument();
    });
  });

  it("toggles cycle settings", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockTeamSettings,
    } as Response);

    render(<TeamGeneralSettingsPage />);
    await screen.findByDisplayValue("Engineering");

    const cycleToggle = screen.getByLabelText("Enable cycles");
    expect(cycleToggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(cycleToggle);
    expect(cycleToggle).toHaveAttribute("aria-checked", "false");

    // Starts on/Length should be disabled
    expect(screen.getByLabelText("Cycle start day")).toBeDisabled();
    expect(screen.getByLabelText("Cycle duration")).toBeDisabled();
  });

  it("changes team key and redirects", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockTeamSettings,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          team: { ...mockTeamSettings.team, key: "SOFT" },
        }),
      } as Response);

    render(<TeamGeneralSettingsPage />);
    await screen.findByDisplayValue("Engineering");

    fireEvent.change(screen.getByDisplayValue("ENG"), {
      target: { value: "SOFT" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/settings/teams/SOFT/general");
    });
  });

  it("opens icon picker and selects emoji", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockTeamSettings,
    } as Response);

    render(<TeamGeneralSettingsPage />);
    await screen.findByDisplayValue("Engineering");

    fireEvent.click(screen.getByLabelText("Change team icon"));
    expect(screen.getByLabelText("Team icon picker")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Choose ⚡ icon"));
    expect(screen.getByText("⚡")).toBeInTheDocument();
    expect(screen.queryByLabelText("Team icon picker")).not.toBeInTheDocument();
  });
});
