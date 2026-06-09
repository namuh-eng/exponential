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
    provider: "google_sheets",
    name: "Google Sheets",
    description:
      "Create an hourly analytics spreadsheet for issues, projects, and initiatives.",
    status: "not_connected",
    displayName: null,
    connectedAt: null,
    setupRequirement: null,
    actions: { canConnect: true, canManage: false, canDisconnect: false },
  },
];

const connectedSheets = {
  provider: "google_sheets",
  name: "Google Sheets",
  description:
    "Create an hourly analytics spreadsheet for issues, projects, and initiatives.",
  status: "connected",
  displayName: "foreverbrowsing analytics",
  connectedAt: "2026-06-09T12:00:00.000Z",
  setupRequirement: null,
  details: {
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/exp_workspace/edit",
    spreadsheetTitle: "foreverbrowsing analytics",
    scopes: { issues: true, projects: true, initiatives: true },
    includePrivateTeams: false,
    schedule: "hourly",
    lastSuccessAt: "2026-06-09T12:00:00.000Z",
    lastErrorAt: null,
    lastError: null,
    nextRunAt: "2026-06-09T13:00:00.000Z",
    rowCounts: { issues: 2, projects: 1, initiatives: 1 },
  },
  actions: { canConnect: false, canManage: true, canDisconnect: true },
};

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

  it("creates and refreshes a Google Sheets analytics sync", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ integrations, canManageIntegrations: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ integration: connectedSheets }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          integrations: [...integrations.slice(0, 2), connectedSheets],
          canManageIntegrations: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ integration: connectedSheets }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          integrations: [...integrations.slice(0, 2), connectedSheets],
          canManageIntegrations: true,
        }),
      });

    render(<IntegrationsSettingsPage />);
    await screen.findByText("No active integrations");
    fireEvent.click(
      screen.getByRole("button", { name: "Explore integrations" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create sheet" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/integrations/google-sheets/connect",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            scopes: { issues: true, projects: true, initiatives: true },
            includePrivateTeams: false,
          }),
        }),
      );
    });
    expect(
      await screen.findByText("Google Sheets analytics sync created."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Open analytics sheet")).toBeInTheDocument();
    expect(screen.getByText(/Rows: issues 2, projects 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/integrations/google-sheets/refresh",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(
      await screen.findByText("Google Sheets analytics sync refreshed."),
    ).toBeInTheDocument();
  });
});
