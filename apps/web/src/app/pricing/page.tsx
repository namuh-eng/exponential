import {
  MarketingCard,
  MarketingShell,
} from "@/components/marketing/public-marketing";
import {
  CommandLink,
  StatusChip,
} from "@/components/marketing/terminal-primitives";

const plans = [
  [
    "Free",
    "$0",
    "For individuals and small teams starting with exponential-style planning.",
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
  title: "Pricing | exponential",
  description: "Public pricing plans for exponential.",
};

export default function PricingPage() {
  return (
    <MarketingShell eyebrow="Pricing">
      <div className="py-14">
        <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-none sm:text-6xl">
          Plans that scale from first issue to enterprise product operations
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--editorial-ink-3)]">
          Choose a plan for your team and keep public pricing navigation inside
          exponential.
        </p>
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.map(([name, price, copy]) => (
            <MarketingCard key={name}>
              <h2 className="text-2xl font-semibold">{name}</h2>
              <p className="mt-4 text-4xl font-semibold">{price}</p>
              <p className="mt-4 min-h-24 text-sm leading-6 text-[var(--editorial-ink-3)]">
                {copy}
              </p>
              <CommandLink href="/signup" variant="primary" className="mt-6">
                Get started
              </CommandLink>
            </MarketingCard>
          ))}
        </div>
        <MarketingCard className="mt-8">
          <h2 className="text-2xl font-semibold">Feature comparison</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {features.map((feature) => (
              <StatusChip key={feature} className="justify-center px-4 py-3">
                {feature}
              </StatusChip>
            ))}
          </div>
        </MarketingCard>
      </div>
    </MarketingShell>
  );
}
