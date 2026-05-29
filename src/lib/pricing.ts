export const PRICING_PLANS = [
  {
    id: "community_self_hosted",
    displayName: "Community Self-hosted",
    billingCadenceLabel: "Free forever",
    priceLabel: "$0",
    deployment: "self_hosted",
    limits: {
      seats: null,
      issuesPerCycle: null,
      workspaces: 1,
    },
    capabilities: [
      "self_hosting",
      "core_issues",
      "projects",
      "community_support",
    ],
    description:
      "Open-source issue tracking for teams that run their own infrastructure.",
    upgradeCta: "Deploy community",
  },
  {
    id: "cloud_free",
    displayName: "Cloud Free",
    billingCadenceLabel: "Free forever",
    priceLabel: "$0",
    deployment: "cloud",
    limits: {
      seats: 3,
      issuesPerCycle: 250,
      workspaces: 1,
    },
    capabilities: [
      "core_issues",
      "projects",
      "cycles",
      "basic_workspace_settings",
    ],
    description:
      "Hosted planning for individuals and small teams getting started.",
    upgradeCta: "Start free",
  },
  {
    id: "cloud_team",
    displayName: "Cloud Team",
    billingCadenceLabel: "Per user / month",
    priceLabel: "$8",
    deployment: "cloud",
    limits: {
      seats: null,
      issuesPerCycle: null,
      workspaces: 3,
    },
    capabilities: [
      "core_issues",
      "projects",
      "cycles",
      "unlimited_issues",
      "team_views",
    ],
    description:
      "Core issue tracking, projects, cycles, and collaboration for focused teams.",
    upgradeCta: "Upgrade to Team",
  },
  {
    id: "cloud_business",
    displayName: "Cloud Business",
    billingCadenceLabel: "Per user / month",
    priceLabel: "$14",
    deployment: "cloud",
    limits: {
      seats: null,
      issuesPerCycle: null,
      workspaces: null,
    },
    capabilities: [
      "core_issues",
      "projects",
      "cycles",
      "unlimited_issues",
      "team_views",
      "admin_controls",
      "workflow_automations",
      "priority_support",
    ],
    description:
      "Advanced workflows, analytics, integrations, and admin controls.",
    upgradeCta: "Upgrade to Business",
  },
  {
    id: "enterprise_cloud",
    displayName: "Enterprise Cloud",
    billingCadenceLabel: "Annual contract",
    priceLabel: "Custom",
    deployment: "cloud",
    limits: {
      seats: null,
      issuesPerCycle: null,
      workspaces: null,
    },
    capabilities: [
      "core_issues",
      "projects",
      "cycles",
      "unlimited_issues",
      "team_views",
      "admin_controls",
      "workflow_automations",
      "priority_support",
      "saml_sso",
      "scim",
      "audit_exports",
      "dedicated_support",
    ],
    description:
      "Managed cloud scale, security, and support for large organizations.",
    upgradeCta: "Contact sales",
  },
  {
    id: "enterprise_self_hosted",
    displayName: "Enterprise Self-hosted",
    billingCadenceLabel: "Annual contract",
    priceLabel: "Custom",
    deployment: "self_hosted",
    limits: {
      seats: null,
      issuesPerCycle: null,
      workspaces: null,
    },
    capabilities: [
      "self_hosting",
      "core_issues",
      "projects",
      "cycles",
      "unlimited_issues",
      "team_views",
      "admin_controls",
      "workflow_automations",
      "priority_support",
      "saml_sso",
      "scim",
      "audit_exports",
      "dedicated_support",
    ],
    description:
      "Enterprise controls for organizations that need to operate the product themselves.",
    upgradeCta: "Contact sales",
  },
] as const;

export type PricingPlan = (typeof PRICING_PLANS)[number];
export type PricingPlanId = PricingPlan["id"];
export type PricingCapability = PricingPlan["capabilities"][number];

export const HOSTED_PRICING_PLAN_IDS = [
  "cloud_free",
  "cloud_team",
  "cloud_business",
  "enterprise_cloud",
] as const satisfies readonly PricingPlanId[];

export type HostedPricingPlanId = (typeof HOSTED_PRICING_PLAN_IDS)[number];

const PRICING_PLAN_IDS = new Set<PricingPlanId>(
  PRICING_PLANS.map((plan) => plan.id),
);
const HOSTED_PLAN_IDS = new Set<PricingPlanId>(HOSTED_PRICING_PLAN_IDS);

export const LEGACY_PLAN_ID_MAP = {
  free: "cloud_free",
  basic: "cloud_team",
  standard: "cloud_business",
  plus: "cloud_business",
  business: "cloud_business",
  enterprise: "enterprise_cloud",
} as const satisfies Record<string, HostedPricingPlanId>;

export function isPricingPlanId(value: unknown): value is PricingPlanId {
  return (
    typeof value === "string" && PRICING_PLAN_IDS.has(value as PricingPlanId)
  );
}

export function isHostedPricingPlanId(
  value: unknown,
): value is HostedPricingPlanId {
  return isPricingPlanId(value) && HOSTED_PLAN_IDS.has(value);
}

export function normalizePricingPlanId(
  value: unknown,
  fallback: HostedPricingPlanId = "cloud_free",
): HostedPricingPlanId {
  if (isHostedPricingPlanId(value)) {
    return value;
  }

  if (typeof value === "string" && value in LEGACY_PLAN_ID_MAP) {
    return LEGACY_PLAN_ID_MAP[value as keyof typeof LEGACY_PLAN_ID_MAP];
  }

  return fallback;
}

export function getPricingPlan(planId: PricingPlanId): PricingPlan {
  return PRICING_PLANS.find((plan) => plan.id === planId) ?? PRICING_PLANS[1];
}

export function hasPricingCapability(
  planId: PricingPlanId,
  capability: PricingCapability,
): boolean {
  return (
    getPricingPlan(planId).capabilities as readonly PricingCapability[]
  ).includes(capability);
}

export function shouldShowUpgradeCta(
  currentPlanId: PricingPlanId,
  targetPlanId: PricingPlanId,
): boolean {
  if (currentPlanId === targetPlanId) {
    return false;
  }

  const currentIndex = PRICING_PLANS.findIndex(
    (plan) => plan.id === currentPlanId,
  );
  const targetIndex = PRICING_PLANS.findIndex(
    (plan) => plan.id === targetPlanId,
  );

  return targetIndex > currentIndex;
}

export type HostedPricingPlan = Extract<
  PricingPlan,
  { id: HostedPricingPlanId }
>;

export const BILLING_PRICING_PLANS = PRICING_PLANS.filter(
  (plan): plan is HostedPricingPlan => isHostedPricingPlanId(plan.id),
);

export function getPlanCtaHref(planId: PricingPlanId): string {
  if (planId === "enterprise_cloud") return "/signup?intent=enterprise-cloud";
  if (planId === "enterprise_self_hosted") {
    return "/signup?intent=enterprise-self-hosted";
  }
  if (planId === "cloud_team") return "/signup?plan=team";
  if (planId === "cloud_business") return "/signup?plan=business";
  return "/signup";
}

export function isCustomPricingPlan(planId: PricingPlanId): boolean {
  return planId === "enterprise_cloud" || planId === "enterprise_self_hosted";
}
