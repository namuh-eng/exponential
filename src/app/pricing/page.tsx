import {
  MarketingCard,
  MarketingShell,
} from "@/components/marketing/public-marketing";
import { PRICING_PLANS, getPlanCtaHref } from "@/lib/pricing";

const comparisonCapabilities = [
  "unlimited_issues",
  "workflow_automations",
  "priority_support",
  "saml_sso",
  "self_hosting",
] as const;

export const metadata = {
  title: "Pricing | Linear clone",
  description: "Public pricing plans for the Linear clone.",
};

export default function PricingPage() {
  return (
    <MarketingShell eyebrow="Pricing">
      <div className="py-14">
        <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-none tracking-[-0.05em] sm:text-6xl">
          Plans that scale from first issue to enterprise product operations
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--editorial-ink-3)]">
          Choose a plan for your team and keep public pricing navigation inside
          the clone.
        </p>
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PRICING_PLANS.map((plan) => (
            <MarketingCard key={plan.id}>
              <h2 className="text-2xl font-semibold">{plan.displayName}</h2>
              <p className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
                {plan.priceLabel}
              </p>
              <p className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-[var(--editorial-ink-3)]">
                {plan.billingCadenceLabel}
              </p>
              <p className="mt-4 min-h-24 text-sm leading-6 text-[var(--editorial-ink-3)]">
                {plan.description}
              </p>
              <a
                href={getPlanCtaHref(plan.id)}
                className="mt-6 inline-flex rounded-full bg-[var(--editorial-ink-1)] px-4 py-2 text-sm font-medium text-[var(--editorial-bg)]"
              >
                {plan.upgradeCta}
              </a>
            </MarketingCard>
          ))}
        </div>
        <MarketingCard className="mt-8">
          <h2 className="text-2xl font-semibold">Self-host support boundary</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--editorial-ink-3)]">
            Community Self-hosted is source-available and self-supported under
            the repository license. Enterprise Self-hosted adds commercial
            license terms, deployment guidance, priority support, and enterprise
            security review workflows without publishing private contact
            details.
          </p>
        </MarketingCard>
        <MarketingCard className="mt-8">
          <h2 className="text-2xl font-semibold">Feature comparison</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {comparisonCapabilities.map((capability) => (
              <div
                key={capability}
                className="rounded-2xl border border-[var(--editorial-line-soft)] bg-[var(--editorial-surface-2)] px-4 py-3 text-sm capitalize"
              >
                {capability.replaceAll("_", " ")}
              </div>
            ))}
          </div>
        </MarketingCard>
      </div>
    </MarketingShell>
  );
}
