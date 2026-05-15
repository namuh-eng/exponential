import { DELETE, GET, PATCH, POST } from "@/app/api/teams/[key]/statuses/route";
import { db } from "@/lib/db";
import {
  issue,
  member,
  team,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const TEST_USER_ID = "16000000-0000-0000-0000-000000000001";
const TEST_WS_ID = "16000000-0000-0000-0000-000000000002";
const TEST_TEAM_ID = "16000000-0000-0000-0000-000000000003";

const TEST_STATE_ID = "16000000-0000-0000-0000-000000000004";
const TEST_STATE_2_ID = "16000000-0000-0000-0000-000000000005";
const TEST_ISSUE_ID = "16000000-0000-0000-0000-000000000006";

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: vi.fn(),
  })),
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";

const getSessionMock = auth.api.getSession as unknown as ReturnType<
  typeof vi.fn
>;

describe("Team Statuses API Route", () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  });

  beforeAll(async () => {
    // Cleanup
    await db.delete(issue).where(eq(issue.teamId, TEST_TEAM_ID));
    await db
      .delete(workflowState)
      .where(eq(workflowState.teamId, TEST_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_TEAM_ID));
    await db.delete(member).where(eq(member.userId, TEST_USER_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));

    // Seed
    await db.insert(user).values({
      id: TEST_USER_ID,
      name: "Status Test User",
      email: "status-test@example.com",
    });

    await db.insert(workspace).values({
      id: TEST_WS_ID,
      name: "Status Test Workspace",
      urlSlug: "status-test",
    });

    await db.insert(member).values({
      userId: TEST_USER_ID,
      workspaceId: TEST_WS_ID,
      role: "admin",
    });

    await db.insert(team).values({
      id: TEST_TEAM_ID,
      workspaceId: TEST_WS_ID,
      name: "Status Team",
      key: "STAT",
    });

    await db.insert(workflowState).values([
      {
        id: TEST_STATE_ID,
        teamId: TEST_TEAM_ID,
        name: "Todo",
        category: "unstarted",
        position: 1,
        isDefault: true,
      },
      {
        id: TEST_STATE_2_ID,
        teamId: TEST_TEAM_ID,
        name: "Later",
        category: "unstarted",
        position: 2,
      },
    ]);

    await db.insert(issue).values({
      id: TEST_ISSUE_ID,
      teamId: TEST_TEAM_ID,
      stateId: TEST_STATE_2_ID,
      creatorId: TEST_USER_ID,
      number: 1,
      identifier: "STAT-1",
      title: "Issue using a status",
    });
  });

  afterAll(async () => {
    await db.delete(issue).where(eq(issue.teamId, TEST_TEAM_ID));
    await db
      .delete(workflowState)
      .where(eq(workflowState.teamId, TEST_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_TEAM_ID));
    await db.delete(member).where(eq(member.userId, TEST_USER_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
  });

  it("creates, edits, reorders, and persists duplicate issue status", async () => {
    const createRes = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          category: "started",
          name: "QA Review",
          description: "Ready for verification",
          color: "#123abc",
        }),
      }),
      { params: Promise.resolve({ key: "STAT" }) },
    );

    expect(createRes.status).toBe(200);
    const createdPayload = await createRes.json();
    const created = createdPayload.statuses.started.find(
      (status: { name: string }) => status.name === "QA Review",
    );
    expect(created).toEqual(
      expect.objectContaining({
        description: "Ready for verification",
        color: "#123abc",
      }),
    );

    const editRes = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          id: created.id,
          name: "Verification",
          description: "Being verified",
          color: "#abcdef",
        }),
      }),
      { params: Promise.resolve({ key: "STAT" }) },
    );
    expect(editRes.status).toBe(200);
    await expect(editRes.json()).resolves.toMatchObject({
      statuses: {
        started: [
          expect.objectContaining({
            id: created.id,
            name: "Verification",
            description: "Being verified",
            color: "#abcdef",
          }),
        ],
      },
    });

    const reorderRes = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          reorder: {
            category: "unstarted",
            orderedIds: [TEST_STATE_2_ID, TEST_STATE_ID],
          },
        }),
      }),
      { params: Promise.resolve({ key: "STAT" }) },
    );
    expect(reorderRes.status).toBe(200);
    const reorderPayload = await reorderRes.json();
    expect(
      reorderPayload.statuses.unstarted.map(
        (status: { id: string }) => status.id,
      ),
    ).toEqual([TEST_STATE_2_ID, TEST_STATE_ID]);

    const duplicateRes = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ duplicateStatusId: created.id }),
      }),
      { params: Promise.resolve({ key: "STAT" }) },
    );
    expect(duplicateRes.status).toBe(200);
    await expect(duplicateRes.json()).resolves.toEqual(
      expect.objectContaining({ duplicateStatusId: created.id }),
    );

    const reloadRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "STAT" }),
    });
    await expect(reloadRes.json()).resolves.toEqual(
      expect.objectContaining({ duplicateStatusId: created.id }),
    );
  });

  it("rejects invalid mutation payloads and blocks unsafe deletion", async () => {
    const invalidCategoryRes = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ category: "unknown", name: "Bad" }),
      }),
      { params: Promise.resolve({ key: "STAT" }) },
    );
    expect(invalidCategoryRes.status).toBe(400);

    const invalidDuplicateRes = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          duplicateStatusId: "16000000-0000-0000-0000-000000009999",
        }),
      }),
      { params: Promise.resolve({ key: "STAT" }) },
    );
    expect(invalidDuplicateRes.status).toBe(400);

    const deleteRes = await DELETE(
      new Request("http://localhost", {
        method: "DELETE",
        body: JSON.stringify({ id: TEST_STATE_2_ID }),
      }),
      { params: Promise.resolve({ key: "STAT" }) },
    );
    expect(deleteRes.status).toBe(400);
    await expect(deleteRes.json()).resolves.toEqual({
      error: "Statuses with issues require a replacement status",
    });
  });

  it("GET returns grouped team statuses", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "STAT" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.statuses.unstarted).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Todo" })]),
    );
    expect(data.statuses.backlog).toBeDefined();
  });
});
