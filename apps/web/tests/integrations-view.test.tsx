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

function integration(overrides: Record<string, unknown>) {
  return {
    provider: "slack",
    name: "Slack",
    description: "Send issue updates and create issues from Slack messages.",

    status: "not_connected",
    displayName: null,
    connectedAt: null,
    setupRequirement: null,
    actions: {
      canConnect: true,
      canManage: false,
      canDisconnect: false,
      canReconnect: false,
    },
    health: {
      lastEventAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureMessage: null,
      tokenExpiresAt: null,
      pendingJobCount: 0,
      failedJobCount: 0,
      auditEvents: [],
    },
    details: {},
    ...overrides,
  };
}

const integrations = [
  integration({
    provider: "github",
    name: "GitHub",
    description:
      "Sync pull requests, commits, and issue links with exponential.",
    status: "configuration_required",
    setupRequirement: {
      type: "configuration_required",
      message: "GitHub setup is not configured in this environment yet.",
    },
    actions: {
      canConnect: false,
      canManage: false,
      canDisconnect: false,
      canReconnect: false,
    },
  }),
  integration({
    provider: "slack",
    name: "Slack",
    status: "not_connected",
    setupRequirement: null,
  }),
  integration({
    provider: "sentry",
    name: "Sentry",
    description: "Create, link, and resolve issues from Sentry errors.",
    status: "configuration_required",
    setupRequirement: {
      type: "configuration_required",
      message: "Sentry credentials are not configured.",
    },
    actions: {
      canConnect: false,
      canManage: false,
      canDisconnect: false,
      canReconnect: false,
    },
  }),
  integration({
    provider: "salesforce",
    name: "Salesforce",
    description:
      "Link cases to issues and projects, then sync status and priority back to support.",
    status: "configuration_required",
    setupRequirement: {
      type: "configuration_required",
      message:
        "Salesforce OAuth credentials and component secret are not configured.",
    },
    actions: {
      canConnect: false,
      canManage: false,
      canDisconnect: false,
      canReconnect: false,
    },
  }),
  integration({
    provider: "front",
    name: "Front",
    description: "Create, link, and reopen issues from Front conversations.",
    status: "not_connected",
  }),
];

const degradedSlack = integration({
  provider: "slack",
  name: "Slack",
  status: "degraded",
  displayName: "Design Ops",
  actions: {
    canConnect: false,
    canManage: true,
    canDisconnect: true,
    canReconnect: true,
  },
  health: {
    lastEventAt: "2026-06-10T12:00:00Z",
    lastSuccessAt: "2026-06-10T11:00:00Z",
    lastFailureAt: "2026-06-10T12:00:00Z",
    lastFailureMessage: "Slack token expired. Reconnect this workspace.",
    tokenExpiresAt: "2026-06-10T12:30:00Z",
    pendingJobCount: 2,
    failedJobCount: 1,
    auditEvents: [
      {
        eventType: "job_failed",
        severity: "error",
        message: "Slack delivery failed after token expiry.",
        createdAt: "2026-06-10T12:00:00Z",
      },
    ],
  },
});

const googleSheets = {
  provider: "google_sheets",
  name: "Google Sheets",
  description:
    "Create an hourly analytics spreadsheet for issues, projects, and initiatives.",
  status: "not_connected",
  displayName: null,
  connectedAt: null,
  setupRequirement: null,
  actions: {
    canConnect: true,
    canManage: false,
    canDisconnect: false,
    canReconnect: false,
  },
  health: {
    lastEventAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureMessage: null,
    tokenExpiresAt: null,
    pendingJobCount: 0,
    failedJobCount: 0,
    auditEvents: [],
  },
};

const connectedSheets = {
  ...googleSheets,
  status: "connected",
  displayName: "workspace analytics",
  actions: {
    canConnect: false,
    canManage: true,
    canDisconnect: true,
    canReconnect: false,
  },
  health: {
    ...googleSheets.health,
    lastEventAt: "2026-06-16T10:00:00Z",
    lastSuccessAt: "2026-06-16T10:00:00Z",
  },
  details: {
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
    spreadsheetTitle: "workspace analytics",
    scopes: { issues: true, projects: true, initiatives: true },
    includePrivateTeams: false,
    schedule: "hourly",
    nextRunAt: "2026-06-16T11:00:00Z",
    rowCounts: { issues: 2, projects: 1, initiatives: 0 },
  },
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
    expect(screen.getByText("Sentry")).toBeInTheDocument();
    expect(screen.getByText("Salesforce")).toBeInTheDocument();
    expect(
      screen.queryByText(/Setup unavailable in this workspace/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Sentry credentials/)).toBeInTheDocument();
    expect(
      screen.getByText(/Salesforce OAuth credentials/),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Connect" }).length,
    ).toBeGreaterThan(0);
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

  it("shows admin health and reconnect state for installed providers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        integrations: [integrations[0], degradedSlack],
        canManageIntegrations: true,
      }),
    });

    render(<IntegrationsSettingsPage />);

    expect(await screen.findByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("2 pending / 1 failed")).toBeInTheDocument();
    expect(
      screen.getByText("Slack token expired. Reconnect this workspace."),
    ).toBeInTheDocument();
    expect(screen.getByText("Audit trail")).toBeInTheDocument();
    expect(
      screen.getByText("Slack delivery failed after token expiry."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reconnect" }),
    ).toBeInTheDocument();
  });

  it("creates and refreshes a Google Sheets analytics sync", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          integrations: [...integrations, googleSheets],
          canManageIntegrations: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authorizationUrl: "https://accounts.google.com/oauth",
        }),
      });

    const assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { assign: assignMock },
      writable: true,
    });

    render(<IntegrationsSettingsPage />);
    await screen.findByText("No active integrations");
    fireEvent.click(
      screen.getByRole("button", { name: "Explore integrations" }),
    );
    expect(screen.getByText("Export scopes")).toBeInTheDocument();
    expect(screen.getByLabelText("Include private teams")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Create sheet" }));

    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith(
        "https://accounts.google.com/oauth",
      ),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/integrations/google-sheets/connect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          scopes: { issues: true, projects: true, initiatives: true },
          includePrivateTeams: false,
        }),
      }),
    );

    cleanup();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          integrations: [integrations[0], connectedSheets],
          canManageIntegrations: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          integrations: [integrations[0], connectedSheets],
          canManageIntegrations: true,
        }),
      });

    render(<IntegrationsSettingsPage />);
    expect(await screen.findByText("Open analytics sheet")).toBeInTheDocument();
    expect(screen.getByText(/Rows: issues 2, projects 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    expect(
      await screen.findByText("Google Sheets analytics sync refreshed."),
    ).toBeInTheDocument();
  });

  it("connects Front with an API token setup form", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ integrations, canManageIntegrations: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "front-id", provider: "front" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          integrations: [degradedSlack],
          canManageIntegrations: true,
        }),
      });

    render(<IntegrationsSettingsPage />);
    await screen.findByText("No active integrations");
    fireEvent.click(
      screen.getByRole("button", { name: "Explore integrations" }),
    );
    fireEvent.change(
      screen.getByPlaceholderText("Optional company identifier"),
      {
        target: { value: "cmp_123" },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Bearer token with conversations/comments permissions",
      ),
      { target: { value: "front-token" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect Front" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/integrations/front/setup",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            apiToken: "front-token",
            companyId: "cmp_123",
            baseUrl: "https://api2.frontapp.com",
          }),
        }),
      );
    });
    expect(await screen.findByText(/Front connected/)).toBeInTheDocument();
  });

  it("connects Zendesk from the catalog setup form", async () => {
    const zendesk = integration({
      provider: "zendesk",
      name: "Zendesk",
      description:
        "Connect support tickets to product work and customer requests.",
      status: "not_connected",
      setupRequirement: null,
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          integrations: [zendesk],
          canManageIntegrations: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accountUrl: "https://acme.zendesk.com",
          actionBaseUrl: "https://app.example/api/integrations/zendesk/tickets",
          actionSecret: "secret",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          integrations: [degradedSlack],
          canManageIntegrations: true,
        }),
      });

    render(<IntegrationsSettingsPage />);
    await screen.findByText("No active integrations");
    fireEvent.click(
      screen.getByRole("button", { name: "Explore integrations" }),
    );
    fireEvent.change(screen.getByLabelText("Zendesk subdomain"), {
      target: { value: "acme" },
    });
    fireEvent.change(screen.getByLabelText("Admin email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("API token"), {
      target: { value: "token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Zendesk" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/integrations/zendesk/setup",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            subdomain: "acme",
            email: "admin@example.com",
            apiToken: "token",
          }),
        }),
      ),
    );
    expect(await screen.findByText("Zendesk app details")).toBeInTheDocument();
    expect(screen.getByText("secret")).toBeInTheDocument();
  });
});
