import {
  MarketingCard,
  MarketingShell,
} from "@/components/marketing/public-marketing";

const plans = [
  [
    "Free",
    "$0",
    "For individuals and small teams starting with Linear-style planning.",
  ],
  [
    "Basic",
    "$8",
    "Essential issue tracking, projects, cycles, and team collaboration.",
  ],
  [
    "Business",
    "$14",
    "Advanced workflows, analytics, integrations, and admin controls.",
  ],
  [
    "Enterprise",
    "Custom",
    "Security, SAML SSO, audit controls, and scaled support for large organizations.",
  ],
];

const features = [
  "Unlimited issues",
  "Roadmaps and initiatives",
  "Customer requests",
  "Workflow automations",
  "Priority support",
];

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
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.map(([name, price, copy]) => (
            <MarketingCard key={name}>
              <h2 className="text-2xl font-semibold">{name}</h2>
              <p className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
                {price}
              </p>
              <p className="mt-4 min-h-24 text-sm leading-6 text-[var(--editorial-ink-3)]">
                {copy}
              </p>
              <a
                href="/signup"
                className="mt-6 inline-flex rounded-full bg-[var(--editorial-ink-1)] px-4 py-2 text-sm font-medium text-[var(--editorial-bg)]"
              >
                Get started
              </a>
            </MarketingCard>
          ))}
        </div>
        <MarketingCard className="mt-8">
          <h2 className="text-2xl font-semibold">Feature comparison</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {features.map((feature) => (
              <div
                key={feature}
                className="rounded-2xl border border-[var(--editorial-line-soft)] bg-[var(--editorial-surface-2)] px-4 py-3 text-sm"
              >
                {feature}
              </div>
            ))}
          </div>
        </MarketingCard>
      </div>
    </MarketingShell>
  );
}
