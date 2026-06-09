import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { and, count, eq } from "drizzle-orm";

import {
  BILLING_PRICING_PLANS,
  type HostedPricingPlanId,
  LEGACY_PLAN_ID_MAP,
  isHostedPricingPlanId,
  normalizePricingPlanId,
} from "@/lib/pricing";

export type EntitlementCapability =
  | "member-limit"
  | "admin-analytics"
  | "saml-sso"
  | "scim";

export type BillingPlanId = HostedPricingPlanId;

export const BILLING_PLANS = BILLING_PRICING_PLANS;

type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function normalizeBillingPlan(value: unknown): BillingPlanId {
  return normalizePricingPlanId(value);
}

export function isSupportedBillingPlanInput(value: unknown): boolean {
  return (
    isHostedPricingPlanId(value) ||
    (typeof value === "string" && value in LEGACY_PLAN_ID_MAP)
  );
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

export function isSelfHostedWorkspace(settings: unknown) {
  const parsed = asRecord(settings);
  const hostingMode = parsed.hostingMode ?? parsed.hosting ?? parsed.deployment;
  return hostingMode === "self-hosted" || hostingMode === "self_hosted";
}

export const PLAN_ENTITLEMENTS: Record<
  BillingPlanId,
  {
    memberLimit: number | null;
    capabilities: EntitlementCapability[];
  }
> = {
  cloud_free: { memberLimit: 3, capabilities: ["member-limit"] },
  cloud_team: {
    memberLimit: null,
    capabilities: ["member-limit"],
  },
  cloud_business: {
    memberLimit: null,
    capabilities: ["member-limit", "admin-analytics"],
  },
  enterprise_cloud: {
    memberLimit: null,
    capabilities: ["member-limit", "admin-analytics", "saml-sso", "scim"],
  },
};

export type EntitlementState = {
  plan: BillingPlanId;
  isSelfHosted: boolean;
  activeSeats: number;
  memberLimit: number | null;
  capabilities: EntitlementCapability[];
};

export async function countActiveWorkspaceMembers(workspaceId: string) {
  const [row] = await db
    .select({ value: count(member.id) })
    .from(member)
    .where(eq(member.workspaceId, workspaceId));

  return Number(row?.value ?? 0);
}

export async function getWorkspaceEntitlements(input: {
  workspaceId: string;
  settings: unknown;
}): Promise<EntitlementState> {
  const billing = readBillingState(input.settings);
  const activeSeats = await countActiveWorkspaceMembers(input.workspaceId);
  const isSelfHosted = isSelfHostedWorkspace(input.settings);
  if (isSelfHosted) {
    return {
      plan: billing.plan,
      isSelfHosted,
      activeSeats,
      memberLimit: null,
      capabilities: ["member-limit", "admin-analytics", "saml-sso", "scim"],
    };
  }

  const plan = PLAN_ENTITLEMENTS[billing.plan];
  return {
    plan: billing.plan,
    isSelfHosted,
    activeSeats,
    memberLimit: plan.memberLimit,
    capabilities: plan.capabilities,
  };
}

export function checkWorkspaceEntitlement(
  entitlements: EntitlementState,
  capability: EntitlementCapability,
) {
  if (!entitlements.capabilities.includes(capability)) {
    return {
      allowed: false as const,
      status: 402,
      code: "upgrade_required",
      error: "Upgrade your workspace plan to use this feature.",
      currentPlan: entitlements.plan,
      requiredPlan:
        capability === "admin-analytics"
          ? "cloud_business"
          : "enterprise_cloud",
    };
  }

  if (
    capability === "member-limit" &&
    entitlements.memberLimit !== null &&
    entitlements.activeSeats >= entitlements.memberLimit
  ) {
    return {
      allowed: false as const,
      status: 402,
      code: "member_limit_reached",
      error: `Your workspace has reached the ${entitlements.memberLimit} member limit for the ${entitlements.plan} plan. Upgrade to invite more members.`,
      currentPlan: entitlements.plan,
      requiredPlan: "cloud_team",
      limit: entitlements.memberLimit,
      activeSeats: entitlements.activeSeats,
    };
  }

  return { allowed: true as const };
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
