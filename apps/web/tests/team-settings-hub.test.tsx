import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerPushMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, refresh: routerRefreshMock }),
  usePathname: () => "/settings/teams/ENG",
  useParams: () => ({ key: "ENG" }),
}));

const mockTeam = {
  name: "Engineering",
  key: "ENG",
  icon: "🟣",
  memberCount: 2,
  labelCount: 11,
  statusCount: 16,
  triageEnabled: true,
  cyclesEnabled: false,
};

describe("TeamSettingsHubPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function renderPage() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ team: mockTeam }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const { default: TeamSettingsHub } = await import(
      "@/app/(app)/settings/teams/[key]/page"
    );
    render(<TeamSettingsHub />);
    await screen.findByText("Engineering");

    return fetchMock;
  }

  it("renders team name", async () => {
    await renderPage();
    expect(screen.getByText("Engineering")).toBeDefined();
  });

  it("renders 'General' card with description", async () => {
    await renderPage();
    expect(screen.getByText("General")).toBeDefined();
    expect(screen.getByText(/identifier, timezone/i)).toBeDefined();
  });

  it("renders 'Members' card with count", async () => {
    await renderPage();
    expect(screen.getByText("Members")).toBeDefined();
    expect(screen.getByText("2 members")).toBeDefined();
  });

  it("renders 'Slack notifications' card", async () => {
    await renderPage();
    expect(screen.getByText("Slack notifications")).toBeDefined();
  });

  it("renders 'Issues, projects, and docs' section", async () => {
    await renderPage();
    expect(screen.getByText("Issues, projects, and docs")).toBeDefined();
  });

  it("renders 'Issue labels' card with count", async () => {
    await renderPage();
    expect(screen.getByText("Issue labels")).toBeDefined();
    expect(screen.getByText("11 labels")).toBeDefined();
  });

  it("renders 'Templates' card", async () => {
    await renderPage();
    expect(screen.getByText("Templates")).toBeDefined();
  });

  it("renders 'Recurring issues' card", async () => {
    await renderPage();
    expect(screen.getByText("Recurring issues")).toBeDefined();
  });

  it("renders 'Workflow' section", async () => {
    await renderPage();
    expect(screen.getByText("Workflow")).toBeDefined();
  });

  it("renders 'Issue statuses' card with count", async () => {
    await renderPage();
    expect(screen.getByText("Issue statuses")).toBeDefined();
    expect(screen.getByText("16 statuses")).toBeDefined();
  });

  it("renders 'Triage' card with enabled status", async () => {
    await renderPage();
    expect(screen.getByText("Triage")).toBeDefined();
    expect(screen.getByText("Enabled")).toBeDefined();
  });

  it("renders 'Cycles' card with off status", async () => {
    await renderPage();
    expect(screen.getByText("Cycles")).toBeDefined();
    expect(screen.getByText("Off")).toBeDefined();
  });

  it("renders 'AI' section with Agents and Discussion summaries", async () => {
    await renderPage();
    expect(screen.getByText("AI")).toBeDefined();
    expect(screen.getByText("Agents")).toBeDefined();
    expect(screen.getByText("Discussion summaries")).toBeDefined();
  });

  it("renders 'Danger zone' section", async () => {
    await renderPage();
    expect(screen.getByText("Danger zone")).toBeDefined();
  });

  it("renders Leave, Retire, Delete team buttons", async () => {
    await renderPage();
    expect(screen.getByText("Leave team")).toBeDefined();
    expect(screen.getByText("Retire team")).toBeDefined();
    expect(screen.getByText("Delete team")).toBeDefined();
  });

  it("renders card links to team settings sub-pages", async () => {
    await renderPage();

    expect(screen.getByRole("link", { name: /general/i })).toHaveAttribute(
      "href",
      "/settings/teams/ENG/general",
    );
    expect(screen.getByRole("link", { name: /members/i })).toHaveAttribute(
      "href",
      "/settings/teams/ENG/members",
    );
    expect(
      screen.getByRole("link", { name: /issue statuses/i }),
    ).toHaveAttribute("href", "/settings/teams/ENG/statuses");
    expect(screen.getByRole("link", { name: /agents/i })).toHaveAttribute(
      "href",
      "/settings/teams/ENG/agents",
    );
  });

  it("opens a leave-team confirmation dialog and submits the danger action", async () => {
    const fetchMock = await renderPage();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          message: "Left Engineering.",
          redirectTo: "/settings",
        }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Leave team" }));

    expect(screen.getByText("Leave team?")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Leave team" })[1]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/teams/ENG/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave" }),
      }),
    );

    expect(routerPushMock).toHaveBeenCalledWith("/settings");
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("shows an inline success message after retiring a team", async () => {
    const fetchMock = await renderPage();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          message: "Engineering is now retired.",
          team: mockTeam,
        }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Retire team" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Retire team" })[1]);

    await screen.findByText("Engineering is now retired.");
  });
});
