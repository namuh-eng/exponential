import { GET, PATCH } from "@/app/api/account/preferences/route";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "12000000-0000-0000-0000-000000000001";

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

describe("Account Preferences API Route", () => {
  beforeAll(async () => {
    // Cleanup
    await db.delete(user).where(eq(user.id, TEST_USER_ID));

    // Seed
    await db.insert(user).values({
      id: TEST_USER_ID,
      name: "Pref Test User",
      email: "pref-test@example.com",
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

  it("GET returns preferences for authenticated user", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accountPreferences).toBeDefined();
    // Should have default theme if not set
    expect(data.accountPreferences.theme).toBe("system");
  });

  it("PATCH updates user preferences", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const req = new Request("http://localhost/api/account/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        accountPreferences: {
          theme: "dark",
          fontSize: "large",
        },
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accountPreferences.theme).toBe("dark");
    expect(data.accountPreferences.fontSize).toBe("large");

    // Verify in DB
    const [updatedUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, TEST_USER_ID))
      .limit(1);
    expect(updatedUser.settings).toBeDefined();
    const settings = updatedUser.settings as {
      accountPreferences: { theme: string };
    };
    expect(settings.accountPreferences.theme).toBe("dark");
  });

  it("PATCH returns 400 if accountPreferences is missing", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const req = new Request("http://localhost/api/account/preferences", {
      method: "PATCH",
      body: JSON.stringify({}),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("accountPreferences is required");
  });
});
