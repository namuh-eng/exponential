import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  resolveActiveWorkspaceId: vi.fn(),
  findAccessibleTeam: vi.fn(),
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  accessRows: [
    {
      workspaceId: "workspace-1",
      workspaceSlug: "foreverbrowsing",
      role: "admin",
      settings: {},
    },
  ] as unknown[],
  workspaceRows: [{ role: "admin", settings: {} }] as unknown[],
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));
vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: mocks.resolveActiveWorkspaceId,
}));
vi.mock("@/lib/teams", () => ({
  findAccessibleTeam: mocks.findAccessibleTeam,
}));
vi.mock("@/lib/db", () => ({
  db: { select: mocks.dbSelect, update: mocks.dbUpdate },
}));

function queryBuilder(rows: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return builder;
}

function setupDb() {
  mocks.dbSelect.mockImplementation((shape: Record<string, unknown>) => {
    if (Object.keys(shape).includes("workspaceSlug")) {
      return queryBuilder(mocks.accessRows);
    }
    return queryBuilder(mocks.workspaceRows);
  });
  const updateBuilder = {
    set: mocks.updateSet.mockReturnThis(),
    where: mocks.updateWhere.mockReturnThis(),
    returning: mocks.updateReturning.mockResolvedValue([
      {
        settings: {
          slackNotifications: {
            enabled: true,
            channelId: "CTRIAGE",
            channelName: "#eng-triage",
            events: {
              issueCreated: true,
              issueCompleted: true,
              comments: true,
              projectUpdates: true,
            },
            updatedAt: "2026-05-20T00:00:00.000Z",
          },
        },
      },
    ]),
  };
  mocks.dbUpdate.mockReturnValue(updateBuilder);
}

function authenticate() {
  mocks.requireApiSession.mockResolvedValue({
    response: null,
    session: { user: { id: "user-1" } },
  });
}

describe("integrations API routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.accessRows = [
      {
        workspaceId: "workspace-1",
        workspaceSlug: "foreverbrowsing",
        role: "admin",
        settings: {},
      },
    ];
    mocks.workspaceRows = [{ role: "admin", settings: {} }];
    mocks.resolveActiveWorkspaceId.mockResolvedValue("workspace-1");
    mocks.findAccessibleTeam.mockResolvedValue({
      id: "team-1",
      workspaceId: "workspace-1",
      name: "Engineering",
      key: "ENG",
      settings: {},
    });
    setupDb();
    authenticate();
  });

  it("lists actionable integration state without placeholder setup copy", async () => {
    const { GET } = await import("@/app/api/integrations/route");
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "slack",
          state: expect.objectContaining({ status: "configuration_required" }),
        }),
      ]),
    );
    expect(JSON.stringify(data)).not.toMatch(/Setup unavailable/i);
  });

  it("returns an explicit Slack configuration error instead of a no-op", async () => {
    const { POST } = await import("@/app/api/integrations/slack/route");
    const response = await POST(
      new Request("http://localhost/api/integrations/slack", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("SLACK_CONFIGURATION_REQUIRED");
    expect(data.error).toMatch(/Slack OAuth credentials are not configured/);
  });

  it("persists a local Slack install and team notification settings", async () => {
    const slackRoute = await import("@/app/api/integrations/slack/route");
    const installResponse = await slackRoute.POST(
      new Request("http://localhost/api/integrations/slack", {
        method: "POST",
        body: JSON.stringify({ localInstall: true }),
      }),
    );
    expect(installResponse.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.any(Object) }),
    );

    mocks.workspaceRows = [
      {
        role: "admin",
        settings: {
          integrations: {
            slack: {
              status: "connected",
              workspaceName: "Local Slack workspace",
              availableChannels: [
                { id: "CENG", name: "#eng" },
                { id: "CTRIAGE", name: "#eng-triage" },
              ],
            },
          },
        },
      },
    ];

    const teamRoute = await import(
      "@/app/api/teams/[key]/slack-notifications/route"
    );
    const saveResponse = await teamRoute.PATCH(
      new Request("http://localhost/api/teams/ENG/slack-notifications", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: true,
          channelId: "CTRIAGE",
          events: { comments: true },
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );
    const data = await saveResponse.json();

    expect(saveResponse.status).toBe(200);
    expect(data.notice).toBe("Slack notification settings saved.");
    expect(mocks.updateSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          slackNotifications: expect.objectContaining({
            enabled: true,
            channelId: "CTRIAGE",
            channelName: "#eng-triage",
          }),
        }),
      }),
    );
  });
});
