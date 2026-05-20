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
  useParams: () => ({ key: "TEAM" }),
}));

const fetchMock = vi.fn();

const disconnectedPayload = {
  team: { name: "Team", key: "TEAM" },
  canManage: true,
  workspaceSlack: {
    status: "configuration_required",
    workspaceName: null,
    availableChannels: [],
    configurationError: "Slack OAuth credentials are not configured.",
  },
  settings: {
    enabled: false,
    channelId: null,
    channelName: null,
    events: {
      issueCreated: true,
      issueCompleted: true,
      comments: false,
      projectUpdates: true,
    },
  },
};

const connectedPayload = {
  team: { name: "Engineering", key: "TEAM" },
  canManage: true,
  workspaceSlack: {
    status: "connected",
    workspaceName: "Local Slack workspace",
    availableChannels: [
      { id: "CENG", name: "#eng" },
      { id: "CTRIAGE", name: "#eng-triage" },
    ],
  },
  settings: {
    enabled: false,
    channelId: "CENG",
    channelName: "#eng",
    events: {
      issueCreated: true,
      issueCompleted: true,
      comments: false,
      projectUpdates: true,
    },
  },
};

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

  it("renders a disconnected state with a real integrations handoff", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => disconnectedPayload,
    });

    render(<TeamSlackSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Slack notifications")).toBeInTheDocument();
    });

    expect(screen.getByText("Slack is not connected")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Connect Slack in integrations" }),
    ).toHaveAttribute("href", "/settings/integrations");
    expect(
      screen.getByText("Slack OAuth credentials are not configured."),
    ).toBeInTheDocument();
  });

  it("saves channel and event notification settings when Slack is connected", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => connectedPayload })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...connectedPayload,
          notice: "Slack notification settings saved.",
          settings: {
            ...connectedPayload.settings,
            enabled: true,
            channelId: "CTRIAGE",
            channelName: "#eng-triage",
            events: { ...connectedPayload.settings.events, comments: true },
          },
        }),
      });

    render(<TeamSlackSettingsPage />);

    expect(
      await screen.findByText("Workspace Slack connected"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Enabled"));
    fireEvent.change(screen.getByLabelText("Slack channel"), {
      target: { value: "CTRIAGE" },
    });
    fireEvent.click(screen.getByLabelText(/New comments/));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/teams/TEAM/slack-notifications",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    expect(
      await screen.findByText("Slack notification settings saved."),
    ).toBeInTheDocument();
  });
});
