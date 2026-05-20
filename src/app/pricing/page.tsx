import {
  Eyebrow,
  MarketingCard,
  MarketingShell,
} from "@/components/public-marketing";
import Link from "next/link";

const plans = [
  {
    name: "Free",
    price: "$0",
    body: "For individuals and small teams starting with issue tracking.",
  },
  {
    name: "Basic",
    price: "$8",
    body: "Core planning workflows, unlimited members, and team collaboration.",
  },
  {
    name: "Business",
    price: "$14",
    body: "Advanced projects, insights, SLAs, and workspace administration.",
  },
  {
    name: "Enterprise",
    price: "Custom",
    body: "Security, support, and governance for large organizations.",
  },
];

const features = [
  "Unlimited issues",
  "Roadmaps and initiatives",
  "Triage and cycles",
  "Customer requests",
  "SAML SSO and audit controls",
];

export const metadata = {
  title: "Pricing | Exponential",
  description:
    "Public Linear-style pricing plans available without authentication.",
};

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-10 lg:px-12">
        <div className="max-w-3xl">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="text-balance text-5xl font-semibold leading-tight tracking-[-0.05em] sm:text-6xl">
            Plans that scale with your product team
          </h1>
          <p className="mt-5 text-lg leading-8 text-[var(--editorial-ink-3)]">
            Choose from Free, Basic, Business, and Enterprise plans with the
            workflows teams need to plan and ship high-quality software.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <MarketingCard key={plan.name}>
              <div className="flex min-h-64 flex-col">
                <h2 className="text-3xl font-semibold">{plan.name}</h2>
                <p className="mt-4 text-4xl font-semibold tracking-tight">
                  {plan.price}
                </p>
                <p className="mt-4 flex-1 leading-7 text-[var(--editorial-ink-3)]">
                  {plan.body}
                </p>
                <Link
                  href="/signup"
                  className="mt-6 inline-flex justify-center rounded-full bg-[var(--editorial-ink-1)] px-4 py-3 text-sm font-semibold text-[var(--editorial-bg)]"
                >
                  Start with {plan.name}
                </Link>
              </div>
            </MarketingCard>
          ))}
        </div>

        <MarketingCard>
          <div className="mt-12">
            <h2 className="text-3xl font-semibold">Feature comparison</h2>
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {features.map((feature) => (
                <div
                  key={feature}
                  className="rounded-2xl border border-[var(--editorial-line)] bg-[var(--editorial-surface-2)] px-4 py-3 text-[var(--editorial-ink-2)]"
                >
                  {feature}
                </div>
              ))}
            </div>
          </div>
        </MarketingCard>
      </section>
    </MarketingShell>
  );
}
