import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getConfiguredAppUrl: vi.fn(),
  getGoogleOAuthConfig: vi.fn(),
  getWorkspaceAccessForSlug: vi.fn(),
  canManageIntegrations: vi.fn(),
  upsertGoogleSheetsIntegration: vi.fn(),
  refreshDueGoogleSheetsIntegrations: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/app-url", () => ({
  getConfiguredAppUrl: mocks.getConfiguredAppUrl,
}));

vi.mock("@/lib/auth-providers", () => ({
  getGoogleOAuthConfig: mocks.getGoogleOAuthConfig,
}));

vi.mock("@/lib/workspace-integrations", () => ({
  canManageIntegrations: mocks.canManageIntegrations,
  getWorkspaceAccessForSlug: mocks.getWorkspaceAccessForSlug,
}));

vi.mock("@/lib/google-sheets-sync", () => ({
  GOOGLE_SHEETS_SCOPES: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ],
  normalizeGoogleSheetsSettings: (value: unknown) => {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as {
            scopes?: Partial<
              Record<"issues" | "projects" | "initiatives", boolean>
            >;
            includePrivateTeams?: boolean;
            enabled?: boolean;
          })
        : {};
    return {
      scopes: {
        issues: raw.scopes?.issues ?? true,
        projects: raw.scopes?.projects ?? true,
        initiatives: raw.scopes?.initiatives ?? true,
      },
      includePrivateTeams: raw.includePrivateTeams ?? false,
      schedule: "hourly",
      enabled: raw.enabled ?? true,
    };
  },
  refreshDueGoogleSheetsIntegrations: mocks.refreshDueGoogleSheetsIntegrations,
  upsertGoogleSheetsIntegration: mocks.upsertGoogleSheetsIntegration,
}));

function encodeState(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("Google Sheets integration routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_SHEETS_SYNC_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubGlobal("fetch", mocks.fetch);

    mocks.requireApiSession.mockResolvedValue({
      response: null,
      session: { user: { id: "user-1" } },
    });
    mocks.getConfiguredAppUrl.mockReturnValue("http://localhost:3015");
    mocks.getGoogleOAuthConfig.mockReturnValue({
      clientId: "google-client",
      clientSecret: "google-secret",
    });
    mocks.getWorkspaceAccessForSlug.mockResolvedValue({
      workspaceId: "workspace-1",
      workspaceSlug: "foreverbrowsing",
      role: "admin",
    });
    mocks.canManageIntegrations.mockReturnValue(true);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 1800,
        scope: "scope-a scope-b",
      }),
    });
    mocks.upsertGoogleSheetsIntegration.mockResolvedValue({
      metadata: {},
      rows: { issues: [], projects: [], initiatives: [] },
    });
    mocks.refreshDueGoogleSheetsIntegrations.mockResolvedValue({
      checked: 2,
      refreshed: 1,
      failed: 0,
      skipped: 1,
    });
  });

  it("persists OAuth tokens with the selected export settings", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-sheets/oauth/callback/route"
    );
    const state = encodeState({
      workspaceSlug: "foreverbrowsing",
      settings: {
        scopes: { issues: true, projects: false, initiatives: true },
        includePrivateTeams: false,
      },
    });

    const response = await GET(
      new Request(
        `http://localhost:3015/api/integrations/google-sheets/oauth/callback?code=oauth-code&state=${state}`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3015/foreverbrowsing/settings/integrations?googleSheets=connected",
    );
    expect(mocks.getWorkspaceAccessForSlug).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: "user-1" } }),
      "foreverbrowsing",
    );
    expect(mocks.upsertGoogleSheetsIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        workspaceSlug: "foreverbrowsing",
      }),
      "user-1",
      expect.objectContaining({
        scopes: { issues: true, projects: false, initiatives: true },
        includePrivateTeams: false,
        accessToken: "access-token",
        refreshToken: "refresh-token",
        oauthScopes: ["scope-a", "scope-b"],
      }),
      "workspace_oauth",
    );
  });

  it("requires a scheduler secret before refreshing due sheets integrations", async () => {
    process.env.GOOGLE_SHEETS_SYNC_SECRET = "sync-secret";
    const { POST } = await import(
      "@/app/api/integrations/google-sheets/sync/route"
    );

    const rejected = await POST(
      new Request("http://localhost/api/integrations/google-sheets/sync", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(rejected.status).toBe(401);

    const accepted = await POST(
      new Request("http://localhost/api/integrations/google-sheets/sync", {
        method: "POST",
        headers: { authorization: "Bearer sync-secret" },
      }),
    );

    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({
      success: true,
      summary: { checked: 2, refreshed: 1, failed: 0, skipped: 1 },
    });
    expect(mocks.refreshDueGoogleSheetsIntegrations).toHaveBeenCalledTimes(1);
  });
});
