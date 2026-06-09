import {
  PRICING_PLANS,
  getPricingPlan,
  hasPricingCapability,
  normalizePricingPlanId,
  shouldShowUpgradeCta,
} from "@/lib/pricing";
import { describe, expect, it } from "vitest";

describe("shared pricing and entitlement model", () => {
  it("defines the six product plans once with stable typed IDs", () => {
    expect(PRICING_PLANS.map((plan) => plan.id)).toEqual([
      "community_self_hosted",
      "cloud_free",
      "cloud_team",
      "cloud_business",
      "enterprise_cloud",
      "enterprise_self_hosted",
    ]);
    expect(getPricingPlan("cloud_team").displayName).toBe("Cloud Team");
    expect(getPricingPlan("cloud_team").priceLabel).toBe("$7");
    expect(getPricingPlan("cloud_business").priceLabel).toBe("$12");
  });

  it("normalizes legacy hosted plan ids to canonical cloud plan ids", () => {
    expect(normalizePricingPlanId("free")).toBe("cloud_free");
    expect(normalizePricingPlanId("basic")).toBe("cloud_team");
    expect(normalizePricingPlanId("business")).toBe("cloud_business");
    expect(normalizePricingPlanId("enterprise")).toBe("enterprise_cloud");
    expect(normalizePricingPlanId("standard")).toBe("cloud_business");
    expect(normalizePricingPlanId("plus")).toBe("cloud_business");
    expect(normalizePricingPlanId("unknown-plan")).toBe("cloud_free");
  });

  it("checks capabilities and upgrade CTA decisions", () => {
    expect(hasPricingCapability("cloud_business", "admin_controls")).toBe(true);
    expect(hasPricingCapability("cloud_free", "admin_controls")).toBe(false);
    expect(shouldShowUpgradeCta("cloud_free", "cloud_business")).toBe(true);
    expect(shouldShowUpgradeCta("cloud_business", "cloud_free")).toBe(false);
    expect(shouldShowUpgradeCta("cloud_business", "cloud_business")).toBe(
      false,
    );
  });
});
