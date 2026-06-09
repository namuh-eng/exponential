import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: replaceMock }),
  usePathname: () => "/settings/teams/ENG/general",
  useParams: () => ({ key: "ENG" }),
}));

const mockTeam = {
  name: "Engineering",
  key: "ENG",
  icon: "🟣",
  timezone: "America/Los_Angeles",
  estimateType: "none",
  emailEnabled: false,
  detailedHistory: false,
  cyclesEnabled: false,
  cycleStartDay: 1,
  cycleDurationWeeks: 2,
};

describe("TeamGeneralSettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    replaceMock.mockReset();
  });

  async function renderPage(
    patchTeam: typeof mockTeam = mockTeam,
    getTeam: typeof mockTeam = mockTeam,
  ) {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ team: getTeam }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ team: patchTeam }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const { default: TeamGeneralPage } = await import(
      "@/app/(app)/settings/teams/[key]/general/page"
    );
    render(<TeamGeneralPage />);
    await screen.findByText("General");

    return fetchMock;
  }

  it("renders page title 'General'", async () => {
    await renderPage();
    expect(screen.getByText("General")).toBeDefined();
  });

  it("renders 'Icon & Name' section", async () => {
    await renderPage();
    expect(screen.getByText("Icon & Name")).toBeDefined();
  });

  it("renders team name input with current value", async () => {
    await renderPage();
    const input = screen.getByDisplayValue("Engineering");
    expect(input).toBeDefined();
  });

  it("renders 'Identifier' section with description", async () => {
    await renderPage();
    expect(screen.getByText("Identifier")).toBeDefined();
    expect(screen.getByText(/used in issue IDs/i)).toBeDefined();
  });

  it("renders identifier input with current key", async () => {
    await renderPage();
    const input = screen.getByDisplayValue("ENG");
    expect(input).toBeDefined();
  });

  it("renders 'Timezone' section with description", async () => {
    await renderPage();
    const timezones = screen.getAllByText("Timezone");
    expect(timezones.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/timezone should be set/i)).toBeDefined();
  });

  it("renders timezone selector", async () => {
    await renderPage();
    const timezoneInput = screen.getByLabelText("Timezone") as HTMLInputElement;
    expect(timezoneInput.value).toContain("GMT-07:00 - Los Angeles");
  });

  it("renders 'Estimates' section with description", async () => {
    await renderPage();
    expect(screen.getByText("Estimates")).toBeDefined();
    expect(screen.getByText(/communicating the complexity/i)).toBeDefined();
  });

  it("renders 'Issue estimation' selector", async () => {
    await renderPage();
    expect(screen.getByText("Issue estimation")).toBeDefined();
  });

  it("renders 'Create issues by email' toggle", async () => {
    await renderPage();
    const matches = screen.getAllByText("Create issues by email");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders 'Enable detailed issue history' toggle", async () => {
    await renderPage();
    expect(screen.getByText("Enable detailed issue history")).toBeDefined();
  });

  it("renders cycle configuration controls", async () => {
    await renderPage();
    expect(screen.getByText("Cycles")).toBeDefined();
    expect(screen.getByText(/configure the cadence/i)).toBeDefined();
    expect(screen.getByText("Enable cycles")).toBeDefined();
    expect(screen.getByText("Starts on")).toBeDefined();
    expect(screen.getByText("Length")).toBeDefined();
  });

  it("saves cycle settings changes", async () => {
    const fetchMock = await renderPage();

    fireEvent.click(screen.getByRole("switch", { name: "Enable cycles" }));
    fireEvent.change(screen.getByLabelText("Cycle start day"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Cycle duration"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/teams/ENG/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Engineering",
          icon: "🟣",
          key: "ENG",
          timezone: "America/Los_Angeles",
          estimateType: "none",
          emailEnabled: false,
          detailedHistory: false,
          cyclesEnabled: true,
          cycleStartDay: 2,
          cycleDurationWeeks: 3,
        }),
      }),
    );
  });

  it("lets the user choose an icon before saving", async () => {
    const fetchMock = await renderPage({
      ...mockTeam,
      icon: "🚀",
    });

    fireEvent.click(screen.getByRole("button", { name: "Change team icon" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose 🚀 icon" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/teams/ENG/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Engineering",
          icon: "🚀",
          key: "ENG",
          timezone: "America/Los_Angeles",
          estimateType: "none",
          emailEnabled: false,
          detailedHistory: false,
          cyclesEnabled: false,
          cycleStartDay: 1,
          cycleDurationWeeks: 2,
        }),
      }),
    );
  });

  it("replaces the route when the identifier changes", async () => {
    await renderPage({
      ...mockTeam,
      key: "QAX2",
    });

    fireEvent.change(screen.getByDisplayValue("ENG"), {
      target: { value: "QAX2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/settings/teams/QAX2/general"),
    );
  });
});
