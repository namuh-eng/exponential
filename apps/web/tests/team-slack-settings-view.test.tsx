import TeamSlackSettingsPage from "@/app/(app)/settings/teams/[key]/slack-notifications/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
}));

const fetchMock = vi.fn();

const availableEvents = [
  { id: "issue_created", label: "New issues", description: "Created" },
  {
    id: "issue_status_changed",
    label: "Status changes",
    description: "Moved",
  },
];

describe("TeamSlackSettingsPage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows an explicit Slack configuration error when workspace Slack is disconnected", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          team: { id: "team-1", key: "ENG", name: "Engineering" },
          workspaceSlack: null,
          canManageSlackNotifications: true,
          availableEvents,
          settings: {
            channelId: "",
            channelName: "",
            enabled: false,
            events: [],
            updatedAt: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          message: "Add AUTH_SLACK_ID and AUTH_SLACK_SECRET to enable Slack.",
        }),
      });

    render(<TeamSlackSettingsPage />);

    expect(await screen.findByText("Slack notifications")).toBeInTheDocument();
    expect(screen.getByText("Slack is not connected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add AUTH_SLACK_ID",
    );
  });

  it("saves channel and event selections when Slack is connected", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          team: { id: "team-1", key: "ENG", name: "Engineering" },
          workspaceSlack: {
            id: "integration-1",
            status: "connected",
            displayName: "Acme Slack",
          },
          canManageSlackNotifications: true,
          availableEvents,
          settings: {
            channelId: "",
            channelName: "",
            enabled: true,
            events: ["issue_created"],
            updatedAt: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          settings: {
            channelId: "eng-alerts",
            channelName: "#eng-alerts",
            enabled: true,
            events: ["issue_created", "issue_status_changed"],
            updatedAt: "2026-05-20T10:00:00.000Z",
          },
        }),
      });

    render(<TeamSlackSettingsPage />);

    expect(
      await screen.findByText(/Workspace Slack connected/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Slack channel"), {
      target: { value: "#eng-alerts" },
    });
    fireEvent.click(screen.getByLabelText(/Status changes/));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/teams/ENG/slack-notifications",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            channelName: "#eng-alerts",
            enabled: true,
            events: ["issue_created", "issue_status_changed"],
          }),
        }),
      ),
    );
    expect(
      await screen.findByText("Slack notification settings saved."),
    ).toBeInTheDocument();
  });
});
