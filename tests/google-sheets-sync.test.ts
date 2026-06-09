import { beforeEach, describe, expect, it, vi } from "vitest";

const selectResults: unknown[][] = [];
const updateSetMock = vi.fn();

function makeQuery(result: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => Promise.resolve(result)),
    limit: vi.fn(() => Promise.resolve(result)),
    // biome-ignore lint/suspicious/noThenProperty: mock Drizzle query awaitable
    then: (resolve: (value: unknown[]) => void) => resolve(result),
  };
  return query;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => makeQuery(selectResults.shift() ?? [])),
    update: vi.fn(() => ({
      set: (...args: unknown[]) => {
        updateSetMock(...args);
        return { where: vi.fn(() => Promise.resolve()) };
      },
    })),
  },
}));

describe("Google Sheets sync", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectResults.length = 0;
  });

  it("defaults to public analytics scopes and excludes private-team data", async () => {
    selectResults.push(
      [
        {
          id: "team-public",
          key: "ENG",
          name: "Engineering",
          isPrivate: false,
        },
        { id: "team-private", key: "SEC", name: "Security", isPrivate: true },
      ],
      [
        {
          id: "issue-public",
          identifier: "ENG-1",
          title: "Public issue",
          teamId: "team-public",
          teamKey: "ENG",
          teamName: "Engineering",
          stateName: "Todo",
          stateCategory: "unstarted",
          priority: "high",
          estimate: 3,
          projectId: "project-public",
          projectName: "Public project",
          assigneeId: null,
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-02T00:00:00.000Z"),
          completedAt: null,
          canceledAt: null,
          archivedAt: null,
        },
      ],
      [
        {
          id: "project-public",
          name: "Public project",
          slug: "public-project",
          status: "started",
          priority: "high",
          leadId: "user-1",
          startDate: null,
          targetDate: null,
          completedAt: null,
          canceledAt: null,
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        },
        {
          id: "project-private",
          name: "Private project",
          slug: "private-project",
          status: "planned",
          priority: "urgent",
          leadId: "user-2",
          startDate: null,
          targetDate: null,
          completedAt: null,
          canceledAt: null,
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        },
      ],
      [
        {
          projectId: "project-public",
          teamId: "team-public",
          teamKey: "ENG",
          isPrivate: false,
        },
        {
          projectId: "project-private",
          teamId: "team-private",
          teamKey: "SEC",
          isPrivate: true,
        },
      ],
      [
        {
          id: "initiative-public",
          name: "Public initiative",
          status: "active",
          health: "on_track",
          ownerId: "user-1",
          startDate: null,
          targetDate: null,
          timeframe: "Q3",
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        },
        {
          id: "initiative-private",
          name: "Private initiative",
          status: "planned",
          health: "unknown",
          ownerId: "user-2",
          startDate: null,
          targetDate: null,
          timeframe: "Q4",
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        },
      ],
      [
        {
          initiativeId: "initiative-public",
          teamId: "team-public",
          teamKey: "ENG",
          isPrivate: false,
        },
        {
          initiativeId: "initiative-private",
          teamId: "team-private",
          teamKey: "SEC",
          isPrivate: true,
        },
      ],
      [
        { initiativeId: "initiative-public", projectId: "project-public" },
        { initiativeId: "initiative-private", projectId: "project-private" },
      ],
    );
    const { refreshGoogleSheetsIntegration } = await import(
      "@/lib/google-sheets-sync"
    );

    const result = await refreshGoogleSheetsIntegration(
      { workspaceId: "workspace-1", workspaceSlug: "foreverbrowsing" },
      { id: "integration-1", metadata: {} },
      new Date("2026-06-09T12:00:00.000Z"),
    );

    expect(result.rows.issues).toHaveLength(1);
    expect(result.rows.projects).toHaveLength(1);
    expect(result.rows.initiatives).toHaveLength(1);
    expect(JSON.stringify(result.rows)).not.toContain("SEC");
    expect(JSON.stringify(result.rows)).not.toContain("Private project");
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "exp_workspace1",
        metadata: expect.objectContaining({
          includePrivateTeams: false,
          lastSuccessAt: "2026-06-09T12:00:00.000Z",
          nextRunAt: "2026-06-09T13:00:00.000Z",
          rowCounts: { issues: 1, projects: 1, initiatives: 1 },
        }),
      }),
    );
  });
});
