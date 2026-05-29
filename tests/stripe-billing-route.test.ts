import { POST as webhookPost } from "@/app/api/stripe/webhook/route";
import { POST as checkoutPost } from "@/app/api/workspaces/current/billing/checkout/route";
import { POST as portalPost } from "@/app/api/workspaces/current/billing/portal/route";
import { db } from "@/lib/db";
import { member, user, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
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

const ADMIN_USER_ID = "54100000-0000-0000-0000-000000000001";
const WORKSPACE_ID = "54100000-0000-0000-0000-000000000010";

const stripeMocks = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  checkoutCreate: vi.fn(),
  portalCreate: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    customers: { create: stripeMocks.customersCreate },
    checkout: { sessions: { create: stripeMocks.checkoutCreate } },
    billingPortal: { sessions: { create: stripeMocks.portalCreate } },
    webhooks: { constructEvent: stripeMocks.constructEvent },
  })),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "activeWorkspaceId" ? { value: WORKSPACE_ID } : undefined,
  })),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { auth } from "@/lib/auth";

describeDb("Stripe billing API", () => {
  beforeAll(async () => {
    await db.delete(member).where(eq(member.workspaceId, WORKSPACE_ID));
    await db.delete(workspace).where(eq(workspace.id, WORKSPACE_ID));
    await db.delete(user).where(eq(user.id, ADMIN_USER_ID));
    await db.insert(user).values({
      id: ADMIN_USER_ID,
      name: "Stripe Admin",
      email: "stripe-admin@example.com",
    });
    await db.insert(workspace).values({
      id: WORKSPACE_ID,
      name: "Stripe Workspace",
      urlSlug: "stripe-workspace-541",
      settings: { billing: { plan: "free" } },
    });
    await db.insert(member).values({
      userId: ADMIN_USER_ID,
      workspaceId: WORKSPACE_ID,
      role: "owner",
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ user: { id: ADMIN_USER_ID } });
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_mock";
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_mock";
    process.env.STRIPE_CLOUD_TEAM_PRICE_ID = "price_team_mock";
    process.env.STRIPE_CLOUD_BUSINESS_PRICE_ID = "price_business_mock";
    await db
      .update(workspace)
      .set({ settings: { billing: { plan: "free" } } })
      .where(eq(workspace.id, WORKSPACE_ID));
    stripeMocks.customersCreate.mockResolvedValue({ id: "cus_mock" });
    stripeMocks.checkoutCreate.mockResolvedValue({
      id: "cs_mock",
      url: "https://stripe.test/checkout",
    });
    stripeMocks.portalCreate.mockResolvedValue({
      url: "https://stripe.test/portal",
    });
  });

  afterAll(async () => {
    await db.delete(member).where(eq(member.workspaceId, WORKSPACE_ID));
    await db.delete(workspace).where(eq(workspace.id, WORKSPACE_ID));
    await db
      .delete(user)
      .where(
        and(
          eq(user.id, ADMIN_USER_ID),
          eq(user.email, "stripe-admin@example.com"),
        ),
      );
  });

  it("creates checkout sessions only for hosted Cloud Team and Business plans", async () => {
    const response = await checkoutPost(
      new Request("http://localhost/api/workspaces/current/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "business" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sessionId: "cs_mock",
      url: "https://stripe.test/checkout",
    });
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        line_items: [{ price: "price_business_mock", quantity: 1 }],
        subscription_data: {
          metadata: { workspaceId: WORKSPACE_ID, plan: "business" },
        },
      }),
    );

    const enterprise = await checkoutPost(
      new Request("http://localhost/api/workspaces/current/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "enterprise" }),
      }),
    );
    expect(enterprise.status).toBe(400);
  });

  it("opens portal for an existing Stripe customer", async () => {
    await db
      .update(workspace)
      .set({ settings: { billing: { stripeCustomerId: "cus_existing" } } })
      .where(eq(workspace.id, WORKSPACE_ID));
    const response = await portalPost(
      new Request("http://localhost/api/workspaces/current/billing/portal", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://stripe.test/portal",
    });
    expect(stripeMocks.portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing" }),
    );
  });

  it("fails closed with a clear server error when Stripe env is missing", async () => {
    process.env.STRIPE_SECRET_KEY = undefined;
    const response = await checkoutPost(
      new Request("http://localhost/api/workspaces/current/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "basic" }),
      }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe(
      "Stripe billing is not configured: missing STRIPE_SECRET_KEY",
    );
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("rejects webhook events with invalid signatures before mutation", async () => {
    stripeMocks.constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const response = await webhookPost(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "bad" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
    const [saved] = await db
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, WORKSPACE_ID))
      .limit(1);
    expect((saved.settings as { billing: { plan: string } }).billing.plan).toBe(
      "free",
    );
  });

  it("updates workspace billing plan from verified subscription webhook", async () => {
    stripeMocks.constructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_mock",
          customer: "cus_mock",
          status: "active",
          metadata: { workspaceId: WORKSPACE_ID },
          items: { data: [{ price: { id: "price_business_mock" } }] },
        },
      },
    });
    const response = await webhookPost(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    const [saved] = await db
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, WORKSPACE_ID))
      .limit(1);
    const billing = (
      saved.settings as {
        billing: {
          plan: string;
          stripeSubscriptionId: string;
          stripeSubscriptionStatus: string;
        };
      }
    ).billing;
    expect(billing.plan).toBe("business");
    expect(billing.stripeSubscriptionId).toBe("sub_mock");
    expect(billing.stripeSubscriptionStatus).toBe("active");
  });
});
