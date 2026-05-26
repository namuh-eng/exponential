import { db } from "@/lib/db";
import {
  member,
  recurringIssue,
  team,
  teamMember,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  DELETE,
  PATCH,
} from "legacy-api/teams/[key]/recurring-issues/[id]/route";
import { GET, POST } from "legacy-api/teams/[key]/recurring-issues/route";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeDb } from "./_helpers/db-integration";

const USER_ID = "20900000-0000-0000-0000-000000000001";
const WORKSPACE_ID = "20900000-0000-0000-0000-000000000002";
const TEAM_ID = "20900000-0000-0000-0000-000000000003";
const STATE_ID = "20900000-0000-0000-0000-000000000004";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      name === "activeWorkspaceId" ? { value: WORKSPACE_ID } : undefined,
    ),
  })),
}));

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

async function cleanupRows() {
  await db.delete(recurringIssue).where(eq(recurringIssue.teamId, TEAM_ID));
  await db.delete(workflowState).where(eq(workflowState.teamId, TEAM_ID));
  await db.delete(teamMember).where(eq(teamMember.teamId, TEAM_ID));
  await db.delete(team).where(eq(team.id, TEAM_ID));
  await db.delete(member).where(eq(member.workspaceId, WORKSPACE_ID));
  await db.delete(workspace).where(eq(workspace.id, WORKSPACE_ID));
  await db.delete(user).where(eq(user.id, USER_ID));
}

async function seedRows() {
  await db.insert(user).values({
    id: USER_ID,
    name: "Recurring User",
    email: "recurring-user@example.com",
  });
  await db.insert(workspace).values({
    id: WORKSPACE_ID,
    name: "Recurring Workspace",
    urlSlug: "recurring-workspace",
  });
  await db.insert(member).values({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    role: "admin",
  });
  await db.insert(team).values({
    id: TEAM_ID,
    workspaceId: WORKSPACE_ID,
    name: "Engineering",
    key: "RCR",
  });
  await db.insert(teamMember).values({ userId: USER_ID, teamId: TEAM_ID });
  await db.insert(workflowState).values({
    id: STATE_ID,
    teamId: TEAM_ID,
    name: "Todo",
    category: "unstarted",
    isDefault: true,
  });
}

describeDb("team recurring issues API", () => {
  beforeEach(async () => {
    await cleanupRows();
    await seedRows();
    getSessionMock.mockResolvedValue({ user: { id: USER_ID } });
  });

  afterEach(async () => {
    await cleanupRows();
    vi.clearAllMocks();
  });

  it("creates and lists recurring issues scoped to the team", async () => {
    const createResponse = await POST(
      new Request("http://localhost/api/teams/RCR/recurring-issues", {
        method: "POST",
        body: JSON.stringify({
          title: "Weekly metrics",
          description: "Prepare the report",
          cadenceConfig: { cadence: "weekly", interval: 1 },
          startAt: "2026-07-01T09:00",
          timezone: "America/Los_Angeles",
        }),
      }),
      { params: Promise.resolve({ key: "RCR" }) },
    );

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.title).toBe("Weekly metrics");
    expect(created.nextRunAt).toBeTruthy();

    const listResponse = await GET(
      new Request("http://localhost/api/teams/RCR/recurring-issues"),
      { params: Promise.resolve({ key: "RCR" }) },
    );
    const list = await listResponse.json();
    expect(list.recurringIssues).toHaveLength(1);
    expect(list.recurringIssues[0].title).toBe("Weekly metrics");
  });

  it("validates required fields", async () => {
    const response = await POST(
      new Request("http://localhost/api/teams/RCR/recurring-issues", {
        method: "POST",
        body: JSON.stringify({
          title: "",
          cadenceConfig: { cadence: "weekly", interval: 1 },
          startAt: "2026-07-01T09:00",
        }),
      }),
      { params: Promise.resolve({ key: "RCR" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Title is required" });
  });

  it("updates, disables, and deletes a recurring issue", async () => {
    const [existing] = await db
      .insert(recurringIssue)
      .values({
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_ID,
        creatorId: USER_ID,
        title: "Original",
        stateId: STATE_ID,
        cadenceConfig: { cadence: "daily", interval: 1 },
        startAt: new Date("2026-07-01T09:00:00Z"),
        nextRunAt: new Date("2026-07-01T09:00:00Z"),
        timezone: "UTC",
      })
      .returning();

    const patchResponse = await PATCH(
      new Request(
        `http://localhost/api/teams/RCR/recurring-issues/${existing.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated", enabled: false }),
        },
      ),
      { params: Promise.resolve({ key: "RCR", id: existing.id }) },
    );

    expect(patchResponse.status).toBe(200);
    const updated = await patchResponse.json();
    expect(updated.title).toBe("Updated");
    expect(updated.enabled).toBe(false);

    const deleteResponse = await DELETE(
      new Request(
        `http://localhost/api/teams/RCR/recurring-issues/${existing.id}`,
        {
          method: "DELETE",
        },
      ),
      { params: Promise.resolve({ key: "RCR", id: existing.id }) },
    );
    expect(deleteResponse.status).toBe(204);

    const remaining = await db
      .select({ id: recurringIssue.id })
      .from(recurringIssue)
      .where(
        and(
          eq(recurringIssue.id, existing.id),
          eq(recurringIssue.teamId, TEAM_ID),
        ),
      );
    expect(remaining).toHaveLength(0);
  });
});
