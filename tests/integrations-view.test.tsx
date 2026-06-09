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
];

const integrationRoadmap = {
  summary: {
    totalItems: 3,
    buildIssues: 2,
    trackedParentItems: 1,
  },
  phases: [
    {
      priority: "P0",
      label: "P0 - build first",
      items: [
        {
          id: "integration-platform",
          priority: "P0",
          buildOrder: 10,
          name: "Shared integration platform",
          provider: null,
          category: "Platform",
          status: "build_issue",
          issue: {
            number: 568,
            title: "P0 Integration platform",
            url: "https://github.com/namuh-eng/exponential/issues/568",
          },
          scope:
            "Provider lifecycle, encrypted secrets, sync jobs, and admin health.",
          planning: {
            setup: "Setup",
            dataModel: "Data model",
            runtime: "Runtime",
            permissions: "Permissions",
            adminUx: "Admin UX",
          },
          acceptanceCriteria: ["Lifecycle is visible", "Jobs are visible"],
          validationPlan: ["Run route coverage", "Run E2E coverage"],
        },
      ],
    },
    {
      priority: "P1",
      label: "P1 - core product parity",
      items: [
        {
          id: "jira-sync-import",
          priority: "P1",
          buildOrder: 120,
          name: "Jira sync and guided import",
          provider: "jira",
          category: "Issue trackers",
          status: "build_issue",
          issue: {
            number: 580,
            title: "P1 Jira",
            url: "https://github.com/namuh-eng/exponential/issues/580",
          },
          scope: "Jira Cloud and Server sync, mapping, and guided importer.",
          planning: {
            setup: "Setup",
            dataModel: "Data model",
            runtime: "Runtime",
            permissions: "Permissions",
            adminUx: "Admin UX",
          },
          acceptanceCriteria: ["Imports work", "Sync works"],
          validationPlan: ["Run importer", "Replay webhooks"],
        },
      ],
    },
  ],
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
      json: async () => ({
        integrations,
        integrationRoadmap,
        canManageIntegrations: true,
      }),
    });

    render(<IntegrationsSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Integrations")).toBeInTheDocument();
      expect(screen.getByText("No active integrations")).toBeInTheDocument();
    });
    expect(screen.getByText("Integration build order")).toBeInTheDocument();
    expect(screen.getByText("P0 - build first")).toBeInTheDocument();
    expect(screen.getByText("Shared integration platform")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#568" })).toHaveAttribute(
      "href",
      "https://github.com/namuh-eng/exponential/issues/568",
    );

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
