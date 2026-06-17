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

const integrationBase = {
  connectedAt: null,
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

const integrations = [
  {
    ...integrationBase,
    provider: "github",
    name: "GitHub",
    description:
      "Sync pull requests, commits, and issue links with exponential.",
    status: "configuration_required",
    displayName: null,
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
  },
  {
    ...integrationBase,
    provider: "slack",
    name: "Slack",
    description: "Send issue updates and create issues from Slack messages.",
    status: "configuration_required",
    displayName: null,
    setupRequirement: {
      type: "configuration_required",
      message: "Slack OAuth credentials are not configured.",
    },
    actions: {
      canConnect: false,
      canManage: false,
      canDisconnect: false,
      canReconnect: false,
    },
  },
  {
    ...integrationBase,
    provider: "sentry",
    name: "Sentry",
    description: "Create, link, and resolve issues from Sentry errors.",
    status: "configuration_required",
    displayName: null,
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
  },
  {
    ...integrationBase,
    provider: "salesforce",
    name: "Salesforce",
    description:
      "Link cases to issues and projects, then sync status and priority back to support.",
    status: "configuration_required",
    displayName: null,
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
  },
  {
    ...integrationBase,
    provider: "front",
    name: "Front",
    description: "Create, link, and reopen issues from Front conversations.",
    status: "not_connected",
    displayName: null,
    setupRequirement: null,
    actions: {
      canConnect: true,
      canManage: false,
      canDisconnect: false,
      canReconnect: false,
    },
  },
];

const degradedSlack = {
  ...integrations[1],
  status: "degraded",
  displayName: "Design Ops",
  setupRequirement: null,
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
    expect(screen.getByText(/Slack OAuth credentials/)).toBeInTheDocument();
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
    const slackCard = screen
      .getByText("Slack")
      .closest("[class*='rounded-lg']");
    expect(slackCard).not.toBeNull();
    fireEvent.click(
      within(slackCard as HTMLElement).getByRole("button", { name: "Connect" }),
    );

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
          integrations: [
            {
              ...integrations[4],
              status: "connected",
              displayName: "Front cmp_123",
              actions: {
                canConnect: false,
                canManage: true,
                canDisconnect: true,
                canReconnect: false,
              },
            },
          ],
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
      { target: { value: "cmp_123" } },
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
    const zendesk = {
      ...integrationBase,
      provider: "zendesk",
      name: "Zendesk",
      description:
        "Connect support tickets to product work and customer requests.",
      status: "not_connected",
      displayName: null,
      setupRequirement: null,
      actions: {
        canConnect: true,
        canManage: false,
        canDisconnect: false,
        canReconnect: false,
      },
    };
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
          integrations: [
            {
              ...zendesk,
              status: "connected",
              displayName: "acme.zendesk.com",
              actions: {
                canConnect: false,
                canManage: true,
                canDisconnect: true,
                canReconnect: false,
              },
            },
          ],
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
