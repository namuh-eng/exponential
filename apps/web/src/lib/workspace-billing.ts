import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export type BillingPlanId = "free" | "basic" | "business" | "enterprise";

export const BILLING_PLANS: Array<{
  id: BillingPlanId;
  name: string;
  price: string;
  description: string;
  features: string[];
}> = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    description: "For individuals and small trials.",
    features: ["3 members", "250 issues", "Basic workspace settings"],
  },
  {
    id: "basic",
    name: "Basic",
    price: "$8/user/month",
    description: "Core issue tracking for focused teams.",
    features: ["Unlimited issues", "5 teams", "Basic automations"],
  },
  {
    id: "business",
    name: "Business",
    price: "$14/user/month",
    description: "Advanced controls for growing organizations.",
    features: ["Unlimited teams", "Admin controls", "Priority support"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    description: "Security, scale, and support for large companies.",
    features: ["SAML/SCIM", "Audit exports", "Dedicated support"],
  },
];

const PLAN_IDS = new Set(BILLING_PLANS.map((plan) => plan.id));

type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function normalizeBillingPlan(value: unknown): BillingPlanId {
  if (value === "standard" || value === "plus") {
    return "business";
  }

  return typeof value === "string" && PLAN_IDS.has(value as BillingPlanId)
    ? (value as BillingPlanId)
    : "free";
}

export function readBillingState(settings: unknown) {
  const parsed = asRecord(settings);
  const billing = asRecord(parsed.billing);
  const paymentMethods = Array.isArray(billing.paymentMethods)
    ? billing.paymentMethods
    : [
        {
          id: "pm_dev_visa",
          brand: "Visa",
          last4: "4242",
          expMonth: 12,
          expYear: 2030,
          isDefault: true,
        },
      ];
  const invoices = Array.isArray(billing.invoices)
    ? billing.invoices
    : [
        {
          id: "inv_dev_001",
          number: "DEV-001",
          date: "2026-05-01",
          amount: "$0.00",
          status: "paid",
        },
      ];

  return {
    plan: normalizeBillingPlan(billing.plan ?? parsed.plan),
    seatsUsed: typeof billing.seatsUsed === "number" ? billing.seatsUsed : 3,
    usageLimit:
      typeof billing.usageLimit === "number" ? billing.usageLimit : 250,
    issuesUsed:
      typeof billing.issuesUsed === "number" ? billing.issuesUsed : 42,
    paymentMethods,
    invoices,
  };
}

export async function findBillingWorkspace(userId: string, request: Request) {
  const workspaceId = await resolveRequestWorkspaceId(userId, request);
  if (!workspaceId) {
    return null;
  }

  const [record] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      urlSlug: workspace.urlSlug,
      settings: workspace.settings,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, userId),
        eq(member.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return record ?? null;
}

export function canManageBilling(role: string) {
  return role === "owner" || role === "admin";
}
