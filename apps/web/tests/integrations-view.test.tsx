import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import IntegrationsSettingsPage from "@/app/(app)/settings/integrations/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

const integrations = [
  {
    provider: "github",
    name: "GitHub",
    description:
      "Sync pull requests, commits, and issue links with exponential.",
    status: "configuration_required",
    displayName: null,
    connectedAt: null,
    setupRequirement: {
      type: "configuration_required",
      message: "GitHub setup is not configured in this environment yet.",
    },
    actions: { canConnect: false, canManage: false, canDisconnect: false },
  },
  {
    provider: "slack",
    name: "Slack",
    description: "Send issue updates and create issues from Slack messages.",
    status: "configuration_required",
    displayName: null,
    connectedAt: null,
    setupRequirement: {
      type: "configuration_required",
      message: "Slack OAuth credentials are not configured.",
    },
    actions: { canConnect: false, canManage: false, canDisconnect: false },
  },
];

describe("IntegrationsSettingsPage component", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads actionable integration cards and shows setup errors instead of placeholder copy", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ integrations, canManageIntegrations: true }),
    });

    render(<IntegrationsSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Integrations")).toBeInTheDocument();
      expect(screen.getByText("No active integrations")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Explore integrations" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Explore integrations",
    });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(
      screen.queryByText(/Setup unavailable in this workspace/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Slack OAuth credentials/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("surfaces Slack connect API failures instead of no-oping", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ integrations, canManageIntegrations: true }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          message: "Add AUTH_SLACK_ID and AUTH_SLACK_SECRET to enable Slack.",
        }),
      });

    render(<IntegrationsSettingsPage />);
    await screen.findByText("No active integrations");
    fireEvent.click(
      screen.getByRole("button", { name: "Explore integrations" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add AUTH_SLACK_ID",
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/integrations/slack/connect",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
