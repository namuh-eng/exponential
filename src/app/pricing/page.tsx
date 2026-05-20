import {
  Card,
  Chip,
  MarketingHero,
  MarketingShell,
  Section,
} from "@/components/marketing/public-marketing";

const plans = [
  {
    name: "Free",
    price: "$0",
    body: "For individuals and small teams getting started.",
    features: ["Unlimited issues", "Core team workspace", "Basic integrations"],
  },
  {
    name: "Basic",
    price: "$8",
    body: "For teams that need planning and collaboration basics.",
    features: ["Projects and cycles", "Roadmaps", "Priority support"],
  },
  {
    name: "Business",
    price: "$14",
    body: "For scaling product organizations.",
    features: ["Advanced insights", "SAML SSO", "Admin controls"],
  },
  {
    name: "Enterprise",
    price: "Custom",
    body: "For companies that need governance and dedicated support.",
    features: ["Security reviews", "Dedicated success", "Custom contracts"],
  },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Pricing"
        title="Plans for every stage of product development"
        description="Choose the Linear-style plan that fits your team today, then scale into richer controls, reporting, and security as your organization grows."
      />

      <Section title="Simple, transparent plans">
        <div className="grid gap-4 lg:grid-cols-4">
          {plans.map((plan) => (
            <Card key={plan.name}>
              <h2 className="font-semibold text-2xl">{plan.name}</h2>
              <p className="mt-4 font-semibold text-4xl">{plan.price}</p>
              <p className="mt-4 min-h-20 text-white/60 leading-7">
                {plan.body}
              </p>
              <ul className="mt-6 space-y-3 text-sm text-white/75">
                {plan.features.map((feature) => (
                  <li key={feature}>✓ {feature}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="Feature comparison"
        description="Every plan includes a fast issue workflow, local clone navigation, and public onboarding surfaces."
      >
        <div className="flex flex-wrap gap-3">
          <Chip>Issue tracking</Chip>
          <Chip>Cycles</Chip>
          <Chip>Projects</Chip>
          <Chip>Customer requests</Chip>
          <Chip>Security controls</Chip>
          <Chip>Agent context</Chip>
        </div>
      </Section>
    </MarketingShell>
  );
}
