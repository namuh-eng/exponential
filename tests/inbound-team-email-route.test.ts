import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();
const transactionMock = vi.fn();
const insertIssueValuesMock = vi.fn();
const insertHistoryValuesMock = vi.fn();
const normalizeIssueDescriptionHtmlMock = vi.fn();
let teamSettings: Record<string, unknown> = { emailEnabled: true };

vi.mock("@/lib/issue-description", () => ({
  normalizeIssueDescriptionHtml: normalizeIssueDescriptionHtmlMock,
}));

vi.mock("@/lib/db/schema", () => ({
  issue: { __name: "issue", number: "issue.number" },
  issueHistory: { __name: "issueHistory" },
  member: { userId: "member.userId", workspaceId: "member.workspaceId" },
  team: {
    id: "team.id",
    key: "team.key",
    workspaceId: "team.workspaceId",
    settings: "team.settings",
  },
  workflowState: {
    id: "workflowState.id",
    teamId: "workflowState.teamId",
    category: "workflowState.category",
  },
  workspace: { id: "workspace.id", urlSlug: "workspace.urlSlug" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: selectMock,
    transaction: transactionMock,
  },
}));

function selectable(rows: unknown[], hasInnerJoin = false) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return hasInnerJoin ? chain : { ...chain, innerJoin: undefined };
}

describe("inbound team email route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Reflect.deleteProperty(process.env, "INBOUND_EMAIL_WEBHOOK_SECRET");
    teamSettings = { emailEnabled: true };
    normalizeIssueDescriptionHtmlMock.mockReturnValue("<p>Email body</p>");
    selectMock.mockImplementation((selection: Record<string, unknown>) => {
      if ("workspaceSlug" in selection) {
        return selectable(
          [
            {
              id: "team-1",
              key: "ENG",
              workspaceId: "workspace-1",
              settings: teamSettings,
              workspaceSlug: "foreverbrowsing",
            },
          ],
          true,
        );
      }

      if ("userId" in selection) {
        return selectable([{ userId: "user-1" }]);
      }

      if ("maxNum" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ maxNum: 41 }]),
          }),
        };
      }

      return selectable([{ id: "state-backlog" }]);
    });
    transactionMock.mockImplementation(async (callback) =>
      callback({
        insert: (table: { __name?: string }) => ({
          values: (...args: unknown[]) => {
            if (table.__name === "issueHistory") {
              insertHistoryValuesMock(...args);
              return Promise.resolve();
            }

            insertIssueValuesMock(...args);
            return {
              returning: vi.fn().mockResolvedValue([
                {
                  id: "issue-1",
                  identifier: "ENG-42",
                  title: "Forwarded bug",
                },
              ]),
            };
          },
        }),
      }),
    );
  });

  it("creates an issue for an enabled team inbound address", async () => {
    const { POST } = await import("@/app/api/inbound/team-email/route");

    const response = await POST(
      new Request("http://localhost/api/inbound/team-email", {
        method: "POST",
        body: JSON.stringify({
          recipient: "eng.foreverbrowsing@team.linear.app",
          from: "reporter@example.com",
          subject: "Forwarded bug",
          text: "Email body",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(201);
    expect(insertIssueValuesMock).toHaveBeenCalledWith({
      number: 42,
      identifier: "ENG-42",
      title: "Forwarded bug",
      description: "<p>Email body</p>",
      teamId: "team-1",
      stateId: "state-backlog",
      creatorId: "user-1",
      priority: "none",
    });
    expect(insertHistoryValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "issue-1",
        eventType: "created",
        metadata: expect.objectContaining({ source: "inbound_email" }),
      }),
    );
  });

  it("rejects inbound email without creating an issue when disabled", async () => {
    teamSettings = { emailEnabled: false };
    const { POST } = await import("@/app/api/inbound/team-email/route");

    const response = await POST(
      new Request("http://localhost/api/inbound/team-email", {
        method: "POST",
        body: JSON.stringify({
          recipient: "eng.foreverbrowsing@team.linear.app",
          subject: "Forwarded bug",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
