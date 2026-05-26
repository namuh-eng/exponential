import { db } from "@/lib/db";
import { member, user, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { GET, PATCH } from "legacy-api/workspaces/current/billing/route";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { describeDb } from "./_helpers/db-integration";

const ADMIN_USER_ID = "22700000-0000-0000-0000-000000000001";
const MEMBER_USER_ID = "22700000-0000-0000-0000-000000000002";
const WORKSPACE_ID = "22700000-0000-0000-0000-000000000010";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "activeWorkspaceId" ? { value: WORKSPACE_ID } : undefined,
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

describeDb("Workspace billing API", () => {
  beforeAll(async () => {
    await db.delete(member).where(eq(member.workspaceId, WORKSPACE_ID));
    await db.delete(workspace).where(eq(workspace.id, WORKSPACE_ID));
    await db.delete(user).where(eq(user.id, ADMIN_USER_ID));
    await db.delete(user).where(eq(user.id, MEMBER_USER_ID));

    await db.insert(user).values([
      {
        id: ADMIN_USER_ID,
        name: "Billing Admin",
        email: "billing-admin@example.com",
      },
      {
        id: MEMBER_USER_ID,
        name: "Billing Member",
        email: "billing-member@example.com",
      },
    ]);
    await db.insert(workspace).values({
      id: WORKSPACE_ID,
      name: "Billing Workspace",
      urlSlug: "billing-workspace-227",
      settings: {
        billing: {
          plan: "free",
          seatsUsed: 4,
          issuesUsed: 99,
          usageLimit: 500,
          paymentMethods: [
            {
              id: "pm_test",
              brand: "Mastercard",
              last4: "4444",
              expMonth: 1,
              expYear: 2031,
              isDefault: true,
            },
          ],
          invoices: [
            {
              id: "inv_test",
              number: "QA-227",
              date: "2026-05-17",
              amount: "$8.00",
              status: "paid",
            },
          ],
        },
      },
    });
    await db.insert(member).values([
      { userId: ADMIN_USER_ID, workspaceId: WORKSPACE_ID, role: "admin" },
      { userId: MEMBER_USER_ID, workspaceId: WORKSPACE_ID, role: "member" },
    ]);
  });

  beforeEach(async () => {
    await db
      .update(workspace)
      .set({
        settings: {
          billing: {
            plan: "free",
            seatsUsed: 4,
            issuesUsed: 99,
            usageLimit: 500,
          },
        },
      })
      .where(eq(workspace.id, WORKSPACE_ID));
  });

  afterAll(async () => {
    await db.delete(member).where(eq(member.workspaceId, WORKSPACE_ID));
    await db.delete(workspace).where(eq(workspace.id, WORKSPACE_ID));
    await db
      .delete(user)
      .where(
        and(
          eq(user.id, ADMIN_USER_ID),
          eq(user.email, "billing-admin@example.com"),
        ),
      );
    await db.delete(user).where(eq(user.id, MEMBER_USER_ID));
  });

  it("returns billing summary with plans, usage, payment methods, and invoices", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: ADMIN_USER_ID },
    });

    const response = await GET(
      new Request("http://localhost/api/workspaces/current/billing"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.currentPlan).toBe("free");
    expect(data.canManage).toBe(true);
    expect(data.usage.issuesUsed).toBe(99);
    expect(data.plans.map((plan: { id: string }) => plan.id)).toContain(
      "business",
    );
    expect(data.paymentMethods[0].brand).toBe("Visa");
    expect(data.invoices[0].number).toBe("DEV-001");
  });

  it("allows admins to persist selected billing plan", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: ADMIN_USER_ID },
    });

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/billing", {
        method: "PATCH",
        body: JSON.stringify({ plan: "business" }),
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.currentPlan).toBe("business");

    const [saved] = await db
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, WORKSPACE_ID))
      .limit(1);
    expect((saved.settings as { billing: { plan: string } }).billing.plan).toBe(
      "business",
    );
  });

  it("rejects non-admin billing mutations", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: MEMBER_USER_ID },
    });

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/billing", {
        method: "PATCH",
        body: JSON.stringify({ plan: "business" }),
      }),
    );

    expect(response.status).toBe(403);
  });
});
