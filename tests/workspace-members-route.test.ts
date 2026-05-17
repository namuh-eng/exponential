import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const membershipLimitMock = vi.fn();
const activeMembersInnerJoinMock = vi.fn();
const teamMembershipsInnerJoinMock = vi.fn();
const lastSeenRecordsInnerJoinMock = vi.fn();
const invitationsWhereMock = vi.fn();
const updateSetMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      // selection matches: { id: member.id, role: member.role } (for loadAuthenticatedAccess)
      // OR { userId: member.userId, role: member.role } (for PATCH target check)
      if (selection && "role" in selection && "settings" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(membershipLimitMock()),
        };
        return chain;
      }

      // selection matches GET activeMembers list
      if (selection && "joinedAt" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          // biome-ignore lint/suspicious/noThenProperty: <explanation>
          then: (resolve: (val: unknown) => void) =>
            resolve(activeMembersInnerJoinMock()),
        };
        return chain;
      }

      // selection matches GET teamMemberships list
      if (selection && "teamName" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          // biome-ignore lint/suspicious/noThenProperty: <explanation>
          then: (resolve: (val: unknown) => void) =>
            resolve(teamMembershipsInnerJoinMock()),
        };
        return chain;
      }

      // selection matches GET lastSeenRecords list
      if (
        selection &&
        "userId" in selection &&
        Object.keys(selection).length === 2
      ) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockReturnThis(),
          // biome-ignore lint/suspicious/noThenProperty: <explanation>
          then: (resolve: (val: unknown) => void) =>
            resolve(lastSeenRecordsInnerJoinMock()),
        };
        return chain;
      }

      // selection matches GET invitations list
      if (selection && "invitedEmail" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          // biome-ignore lint/suspicious/noThenProperty: <explanation>
          then: (resolve: (val: unknown) => void) =>
            resolve(invitationsWhereMock()),
        };
        return chain;
      }

      // PATCH member lookup
      // selection: { userId: member.userId, role: member.role }
      if (selection && "userId" in selection && "role" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi
            .fn()
            .mockResolvedValue([
              { id: "member-1", userId: "user-2", role: "member" },
            ]),
        };
        return chain;
      }

      const chain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        // biome-ignore lint/suspicious/noThenProperty: <explanation>
        then: (resolve: (val: unknown) => void) => resolve([]),
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: (...setArgs: unknown[]) => {
        updateSetMock(...setArgs);
        return {
          where: vi.fn().mockResolvedValue([{ id: "member-1" }]),
        };
      },
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/db/schema", () => ({
  memberRole: { enumValues: ["owner", "admin", "member"] },
  member: { __name: "member" },
  workspace: { __name: "workspace" },
  workspaceInvitation: { __name: "workspaceInvitation" },
  user: { __name: "user" },
  team: { __name: "team" },
  teamMember: { __name: "teamMember" },
  session: { __name: "session" },
}));

describe("workspace members route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    membershipLimitMock.mockReturnValue([
      { id: "member-1", role: "owner", userId: "user-1", settings: {} },
    ]);
    activeMembersInnerJoinMock.mockReturnValue([
      {
        id: "member-1",
        userId: "user-1",
        name: "Ashley",
        email: "ashley@test.com",
        image: null,
        role: "owner",
        joinedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);
    teamMembershipsInnerJoinMock.mockReturnValue([
      { userId: "user-1", teamName: "Engineering" },
    ]);
    lastSeenRecordsInnerJoinMock.mockReturnValue([
      {
        userId: "user-1",
        lastSeenAt: new Date("2026-05-01T00:00:00.000Z").toISOString(),
      },
    ]);
    invitationsWhereMock.mockReturnValue([]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/workspaces/members/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns full members and invitations list", async () => {
    const { GET } = await import("@/app/api/workspaces/members/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.members.length).toBe(1);
    expect(payload.members[0].name).toBe("Ashley");
    expect(payload.members[0].teams).toEqual(["Engineering"]);
    expect(payload.canInviteMembers).toBe(true);
  });

  it("returns invite capability from workspace security permissions", async () => {
    membershipLimitMock.mockReturnValue([
      {
        id: "member-1",
        role: "member",
        userId: "user-1",
        settings: { security: { permissions: { invitationsRole: "admins" } } },
      },
    ]);
    const { GET } = await import("@/app/api/workspaces/members/route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      viewerRole: "member",
      canInviteMembers: false,
    });
  });

  it("updates member role", async () => {
    const { PATCH } = await import("@/app/api/workspaces/members/route");

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/members", {
        method: "PATCH",
        body: JSON.stringify({ kind: "member", id: "member-1", role: "admin" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin" }),
    );
  });
});
