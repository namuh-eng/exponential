import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AISettingsPage from "../src/app/(app)/settings/ai/page";

const mockAnalyticsData = {
  workspaceId: "ws_1",
  completedLast30Days: [
    { teamId: "t1", teamName: "Engineering", completedCount: 15 },
    { teamId: "t2", teamName: "Product", completedCount: 5 },
  ],
  activeIssues: [
    { teamId: "t1", teamName: "Engineering", activeCount: 20 },
    { teamId: "t2", teamName: "Product", activeCount: 8 },
  ],
  period: "Last 30 days",
};

const mockAiSettingsData = {
  aiSettings: {
    aiFeaturesEnabled: true,
    askLinearEnabled: true,
    issueSuggestionsEnabled: true,
    summariesEnabled: true,
    autoTriageEnabled: false,
    workspaceAgentGuidance: "Cite evidence in every agent summary.",
    agentUsagePermission: "members",
  },
  capabilities: {
    canManageAiSettings: true,
    canUseAgents: true,
  },
  limits: {
    workspaceAgentGuidanceMaxLength: 4000,
  },
};

function mockFetchResponses({
  aiSettings = mockAiSettingsData,
  analytics = mockAnalyticsData,
}: {
  aiSettings?: unknown;
  analytics?: unknown;
} = {}) {
  (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (url: string, init?: RequestInit) => {
      if (url === "/api/workspaces/current/ai-settings") {
        if (init?.method === "PATCH") {
          return {
            ok: true,
            json: async () => ({
              ...mockAiSettingsData,
              aiSettings: JSON.parse(String(init.body)).aiSettings,
            }),
          };
        }
        return { ok: true, json: async () => aiSettings };
      }
      if (url === "/api/analytics/workspace") {
        return { ok: true, json: async () => analytics };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  );
}

describe("AISettingsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders loading state initially", () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Promise(() => {}),
    );
    render(<AISettingsPage />);
    expect(screen.getByText("Loading...")).toBeDefined();
  });

  it("renders editable workspace AI controls before secondary analytics", async () => {
    mockFetchResponses();

    render(<AISettingsPage />);

    expect(await screen.findByText("Workspace AI controls")).toBeDefined();
    expect(
      screen.getByLabelText("Enable AI and agent features"),
    ).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Workspace agent guidance")).toHaveProperty(
      "value",
      "Cite evidence in every agent summary.",
    );
    expect(screen.getByLabelText("Who can use agents")).toHaveProperty(
      "value",
      "members",
    );
    expect(screen.getByText("Usage")).toBeDefined();
    expect(screen.getByText("28")).toBeDefined();
    expect(screen.getByText("Engineering")).toBeDefined();
  });

  it("saves changed workspace AI settings", async () => {
    mockFetchResponses();

    render(<AISettingsPage />);

    const guidance = await screen.findByLabelText("Workspace agent guidance");
    fireEvent.change(guidance, {
      target: { value: "Escalate privacy-sensitive requests." },
    });
    fireEvent.change(screen.getByLabelText("Who can use agents"), {
      target: { value: "admins" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.getByText("Workspace AI settings saved.")).toBeDefined();
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/current/ai-settings",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("disables controls for non-admin users", async () => {
    mockFetchResponses({
      aiSettings: {
        ...mockAiSettingsData,
        capabilities: { canManageAiSettings: false, canUseAgents: true },
      },
    });

    render(<AISettingsPage />);

    expect(await screen.findByText("Admin-only editing")).toBeDefined();
    expect(
      screen.getByLabelText("Enable AI and agent features"),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows error message when settings and analytics fetches fail", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => {
        if (url === "/api/workspaces/current/ai-settings") {
          return {
            ok: false,
            json: async () => ({ error: "Failed to load AI settings" }),
          };
        }
        if (url === "/api/analytics/workspace") {
          return { ok: false, json: async () => ({}) };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );

    render(<AISettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load AI settings/)).toBeDefined();
      expect(
        screen.getByText(/Workspace usage could not be loaded/),
      ).toBeDefined();
    });
  });

  it("shows empty state in table when no active issues", async () => {
    mockFetchResponses({
      analytics: {
        ...mockAnalyticsData,
        activeIssues: [],
        completedLast30Days: [],
      },
    });

    render(<AISettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("No team activity found.")).toBeDefined();
    });
  });
});
