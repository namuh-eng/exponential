import { GET, PATCH } from "@/app/api/account/notifications/route";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "11000000-0000-0000-0000-000000000001";

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
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

describe("Account Notifications API Route", () => {
  beforeAll(async () => {
    // Cleanup
    await db.delete(user).where(eq(user.id, TEST_USER_ID));

    // Seed
    await db.insert(user).values({
      id: TEST_USER_ID,
      name: "Notif Test User",
      email: "notif-test@example.com",
      settings: {},
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
  });

  it("GET returns 401 if no session", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("GET returns notification settings for authenticated user", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accountNotifications).toBeDefined();
    expect(data.accountNotifications.channels).toBeDefined();
  });

  it("PATCH updates notification settings", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const req = new Request("http://localhost/api/account/notifications", {
      method: "PATCH",
      body: JSON.stringify({
        accountNotifications: {
          updatesFromLinear: {
            showInSidebar: false,
          },
        },
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accountNotifications.updatesFromLinear.showInSidebar).toBe(
      false,
    );

    // Verify in DB
    const [updatedUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, TEST_USER_ID))
      .limit(1);
    const settings = updatedUser.settings as {
      accountNotifications: { updatesFromLinear: { showInSidebar: boolean } };
    };
    expect(settings.accountNotifications.updatesFromLinear.showInSidebar).toBe(
      false,
    );
  });

  it("PATCH returns 400 if accountNotifications is missing", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const req = new Request("http://localhost/api/account/notifications", {
      method: "PATCH",
      body: JSON.stringify({}),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("accountNotifications is required");
  });
});
