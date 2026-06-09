import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import IntegrationsSettingsPage from "@/app/(app)/settings/integrations/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

const integrations = [
  {
    provider: "github",
    name: "GitHub",
    description: "Sync pull requests, commits, and issue links with Linear.",
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
  {
    provider: "notion",
    name: "Notion",
    description:
      "Show private-safe rich previews when Exponential links are pasted in Notion.",
    status: "not_connected",
    displayName: null,
    connectedAt: null,
    setupRequirement: null,
    actions: { canConnect: true, canManage: false, canDisconnect: false },
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
    expect(screen.getByText("Notion")).toBeInTheDocument();
    expect(
      screen.queryByText(/Setup unavailable in this workspace/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Slack OAuth credentials/)).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("button", { name: "Connect" }),
    ).toHaveLength(2);
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
    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add AUTH_SLACK_ID",
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/integrations/slack/connect",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("connects Notion rich previews and reloads the catalog", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ integrations, canManageIntegrations: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          previewEndpoint: "http://localhost/api/integrations/notion/unfurl",
          previewToken: "notion_unfurl_test",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          integrations: [
            {
              ...integrations[2],
              status: "connected",
              displayName: "Notion rich previews",
              connectedAt: "2026-06-09T12:00:00.000Z",
              actions: {
                canConnect: false,
                canManage: true,
                canDisconnect: true,
              },
            },
          ],
        }),
      });

    render(<IntegrationsSettingsPage />);
    await screen.findByText("No active integrations");
    fireEvent.click(
      screen.getByRole("button", { name: "Explore integrations" }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[1]);

    expect(
      await screen.findByText("Notion rich previews connected."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("http://localhost/api/integrations/notion/unfurl"),
    ).toBeInTheDocument();
    expect(screen.getByText("notion_unfurl_test")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/notion/connect",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("disconnects the current user's Notion rich preview token", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          integrations: [
            {
              ...integrations[2],
              status: "connected",
              displayName: "Notion rich previews",
              connectedAt: "2026-06-09T12:00:00.000Z",
              actions: {
                canConnect: false,
                canManage: true,
                canDisconnect: true,
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, provider: "notion" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ integrations }),
      });

    render(<IntegrationsSettingsPage />);
    await screen.findByText("Connected to Notion rich previews");

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(
      await screen.findByText("Integration disconnected."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/notion/disconnect",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
