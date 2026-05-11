import { GET } from "@/app/api/account/security/route";
import { db } from "@/lib/db";
import { account, session as sessionTable, user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "35000000-0000-0000-0000-000000000001";
const CURRENT_SESSION_ID = "issue-35-current-session";
const OTHER_SESSION_ID = "issue-35-other-session";
const PROVIDER_ID = "issue-35-google-account";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";

describe("Account Security API Route", () => {
  beforeAll(async () => {
    await db.delete(account).where(eq(account.userId, TEST_USER_ID));
    await db.delete(sessionTable).where(eq(sessionTable.userId, TEST_USER_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));

    await db.insert(user).values({
      id: TEST_USER_ID,
      name: "Security Test User",
      email: "issue-35-security@example.com",
      settings: {},
    });

    await db.insert(sessionTable).values([
      {
        id: CURRENT_SESSION_ID,
        userId: TEST_USER_ID,
        token: "secret-current-session-token",
        userAgent: "Mozilla/5.0 Current Browser",
        ipAddress: "203.0.113.10",
        createdAt: new Date("2026-01-01T10:00:00.000Z"),
        updatedAt: new Date("2026-01-02T10:00:00.000Z"),
        expiresAt: new Date("2026-02-01T10:00:00.000Z"),
      },
      {
        id: OTHER_SESSION_ID,
        userId: TEST_USER_ID,
        token: "secret-other-session-token",
        userAgent: "Mozilla/5.0 Other Browser",
        ipAddress: "203.0.113.11",
        createdAt: new Date("2026-01-03T10:00:00.000Z"),
        updatedAt: new Date("2026-01-04T10:00:00.000Z"),
        expiresAt: new Date("2026-02-03T10:00:00.000Z"),
      },
    ]);

    await db.insert(account).values({
      id: PROVIDER_ID,
      userId: TEST_USER_ID,
      providerId: "google",
      accountId: "google-user-123",
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      idToken: "secret-id-token",
      password: "secret-password-hash",
      createdAt: new Date("2026-01-05T10:00:00.000Z"),
      updatedAt: new Date("2026-01-06T10:00:00.000Z"),
    });
  });

  afterAll(async () => {
    await db.delete(account).where(eq(account.userId, TEST_USER_ID));
    await db.delete(sessionTable).where(eq(sessionTable.userId, TEST_USER_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
  });

  it("returns 401 if no session", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("returns safe sessions and providers for the current user", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
      session: { id: CURRENT_SESSION_ID },
    });

    const res = await GET();
    const data = await res.json();
    const serialized = JSON.stringify(data);

    expect(res.status).toBe(200);
    expect(data.sessions).toHaveLength(2);
    expect(data.providers).toHaveLength(1);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: CURRENT_SESSION_ID,
          isCurrent: true,
          userAgent: "Mozilla/5.0 Current Browser",
          ipAddress: "203.0.113.10",
        }),
        expect.objectContaining({
          id: OTHER_SESSION_ID,
          isCurrent: false,
        }),
      ]),
    );
    expect(data.providers[0]).toEqual(
      expect.objectContaining({
        id: PROVIDER_ID,
        providerId: "google",
        accountId: "google-user-123",
      }),
    );

    expect(serialized).not.toContain("secret-current-session-token");
    expect(serialized).not.toContain("secret-other-session-token");
    expect(serialized).not.toContain("secret-access-token");
    expect(serialized).not.toContain("secret-refresh-token");
    expect(serialized).not.toContain("secret-id-token");
    expect(serialized).not.toContain("secret-password-hash");
    expect(data.sessions[0]).not.toHaveProperty("token");
    expect(data.providers[0]).not.toHaveProperty("accessToken");
    expect(data.providers[0]).not.toHaveProperty("refreshToken");
    expect(data.providers[0]).not.toHaveProperty("idToken");
    expect(data.providers[0]).not.toHaveProperty("password");
  });
});
