import {
  MarketingCard,
  MarketingSection,
  MarketingShell,
} from "@/components/marketing-page";

const plans = ["Free", "Basic", "Business", "Enterprise"];

export default function PricingPage() {
  return (
    <MarketingShell
      eyebrow="Pricing"
      title="Choose the plan that fits your product organization"
      description="Start with Linear for free, then scale into richer collaboration, security, and enterprise controls as your team grows."
    >
      <MarketingSection title="Plans">
        <div className="grid gap-4 md:grid-cols-4">
          {plans.map((plan) => (
            <MarketingCard key={plan}>
              <h3 className="text-2xl font-semibold text-white">{plan}</h3>
              <p className="mt-3 text-[#c9c0b6]">
                Issues, projects, cycles, views, integrations, and support
                matched to {plan.toLowerCase()} teams.
              </p>
            </MarketingCard>
          ))}
        </div>
      </MarketingSection>
      <MarketingSection title="Feature comparison">
        <p className="text-[#c9c0b6]">
          Compare workspace administration, roadmap planning, guest access, SAML
          SSO, priority support, and advanced security controls.
        </p>
      </MarketingSection>
    </MarketingShell>
  );
}
