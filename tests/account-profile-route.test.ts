import { GET, PATCH } from "@/app/api/account/profile/route";
import { db } from "@/lib/db";
import { member, user, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "13000000-0000-0000-0000-000000000001";
const TEST_WS_ID = "13000000-0000-0000-0000-000000000002";

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

describe("Account Profile API Route", () => {
  beforeAll(async () => {
    // Cleanup
    await db.delete(member).where(eq(member.userId, TEST_USER_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));

    // Seed
    await db.insert(user).values({
      id: TEST_USER_ID,
      name: "Test User",
      email: "profile-test@example.com",
      settings: { accountProfile: { username: "testuser" } },
    });

    await db.insert(workspace).values({
      id: TEST_WS_ID,
      name: "Profile Test Workspace",
      urlSlug: "profile-test",
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

  it("GET returns 401 if no session", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("GET returns profile data for authenticated user", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profile.name).toBe("Test User");
    expect(data.workspaceAccess.currentWorkspaceName).toBe(
      "Profile Test Workspace",
    );
  });

  it("PATCH updates user profile", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const req = new Request("http://localhost/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated Name",
        username: "updateduser",
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profile.name).toBe("Updated Name");
    expect(data.profile.username).toBe("updateduser");

    // Verify in DB
    const [updatedUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, TEST_USER_ID))
      .limit(1);
    expect(updatedUser.name).toBe("Updated Name");
  });

  it("PATCH returns 400 for invalid username (with spaces)", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const req = new Request("http://localhost/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Test",
        username: "invalid user",
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Username must be a single word");
  });
});
