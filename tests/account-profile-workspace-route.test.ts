import { DELETE } from "@/app/api/account/profile/workspace/route";
import { db } from "@/lib/db";
import { member, user, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "14000000-0000-0000-0000-000000000001";
const TEST_WS_ID = "14000000-0000-0000-0000-000000000002";

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: vi.fn((name) => {
      if (name === "activeWorkspaceId") return { value: TEST_WS_ID };
      return undefined;
    }),
    set: vi.fn(),
    delete: vi.fn(),
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

describe("Account Profile Workspace API Route (Leave Workspace)", () => {
  beforeAll(async () => {
    // Cleanup
    await db.delete(member).where(eq(member.userId, TEST_USER_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));

    // Seed
    await db.insert(user).values({
      id: TEST_USER_ID,
      name: "Leave Test User",
      email: "leave-test@example.com",
      settings: {},
    });

    await db.insert(workspace).values({
      id: TEST_WS_ID,
      name: "Leave Test Workspace",
      urlSlug: "leave-test",
    });

    await db.insert(member).values({
      userId: TEST_USER_ID,
      workspaceId: TEST_WS_ID,
      role: "admin",
    });
  });

  afterAll(async () => {
    await db.delete(member).where(eq(member.userId, TEST_USER_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
  });

  it("DELETE returns 401 if no session", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("DELETE removes user from active workspace and redirects correctly", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });

    const res = await DELETE();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.redirectTo).toBe("/create-workspace");

    // Verify membership is gone
    const memberships = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.userId, TEST_USER_ID),
          eq(member.workspaceId, TEST_WS_ID),
        ),
      );
    expect(memberships.length).toBe(0);
  });
});
