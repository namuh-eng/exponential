import { GET, PATCH } from "@/app/api/account/preferences/route";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { describeDb } from "./_helpers/db-integration";

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

describeDb("Account Preferences API Route", () => {
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
    expect(data.accountPreferences.automations).toEqual({
      autoAssignment: "off",
      gitBranchFormat: "team-id-title",
      statusTransitions: "manual",
    });
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
          automations: {
            autoAssignment: "assign-to-me",
            gitBranchFormat: "owner/team-id-title",
            statusTransitions: "started",
          },
        },
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accountPreferences.theme).toBe("dark");
    expect(data.accountPreferences.fontSize).toBe("large");
    expect(data.accountPreferences.automations).toEqual({
      autoAssignment: "assign-to-me",
      gitBranchFormat: "owner/team-id-title",
      statusTransitions: "started",
    });

    // Verify in DB
    const [updatedUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, TEST_USER_ID))
      .limit(1);
    expect(updatedUser.settings).toBeDefined();
    const settings = updatedUser.settings as {
      accountPreferences: {
        theme: string;
        automations: { autoAssignment: string };
      };
    };
    expect(settings.accountPreferences.theme).toBe("dark");
    expect(settings.accountPreferences.automations.autoAssignment).toBe(
      "assign-to-me",
    );
  });

  it("PATCH normalizes invalid automation preferences to defaults", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const req = new Request("http://localhost/api/account/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        accountPreferences: {
          automations: {
            autoAssignment: "everyone",
            gitBranchFormat: "unsafe",
            statusTransitions: "magic",
          },
        },
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accountPreferences.automations).toEqual({
      autoAssignment: "off",
      gitBranchFormat: "team-id-title",
      statusTransitions: "manual",
    });
  });

  it("PATCH validates and persists agent personalization fields", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const req = new Request("http://localhost/api/account/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        accountPreferences: {
          agentPersonalization: {
            instructions: "Prefer tiny diffs and cite test evidence.",
            autoFix: true,
          },
        },
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accountPreferences.agentPersonalization).toEqual({
      instructions: "Prefer tiny diffs and cite test evidence.",
      autoFix: true,
    });

    const [updatedUser] = await db
      .select({ settings: user.settings })
      .from(user)
      .where(eq(user.id, TEST_USER_ID))
      .limit(1);
    expect(
      (
        updatedUser.settings as {
          accountPreferences: {
            agentPersonalization: { instructions: string; autoFix: boolean };
          };
        }
      ).accountPreferences.agentPersonalization,
    ).toEqual({
      instructions: "Prefer tiny diffs and cite test evidence.",
      autoFix: true,
    });
  });

  it("PATCH normalizes invalid agent personalization values to safe defaults", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: TEST_USER_ID },
    });
    const req = new Request("http://localhost/api/account/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        accountPreferences: {
          agentPersonalization: {
            instructions: 123,
            autoFix: "yes",
          },
        },
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accountPreferences.agentPersonalization).toEqual({
      instructions: "",
      autoFix: false,
    });
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
