import {
  Card,
  Chip,
  MarketingHero,
  MarketingShell,
  Section,
} from "@/components/marketing/public-marketing";

const stories = [
  ["OpenAI", "Why OpenAI chose Linear and scaled to 3,000 users", "AI"],
  [
    "Ramp",
    "How Ramp aligns engineering, design, and product operations",
    "Fintech",
  ],
  [
    "Vercel",
    "Shipping platform work with clear ownership and fast triage",
    "Developer tools",
  ],
];

export default function CustomersPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Customers"
        title="Built for teams shaping the future of software"
        description="Representative customer stories show how modern product organizations keep focus while scaling engineering execution."
      />

      <Section title="Featured stories">
        <div className="mb-6 flex flex-wrap gap-3">
          <Chip>All</Chip>
          <Chip>AI</Chip>
          <Chip>Developer tools</Chip>
          <Chip>Fintech</Chip>
          <Chip>Enterprise</Chip>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {stories.map(([company, headline, category]) => (
            <Card key={company}>
              <p className="text-sm text-violet-300">{category}</p>
              <h2 className="mt-4 font-semibold text-2xl">{company}</h2>
              <p className="mt-4 text-white/65 leading-7">{headline}</p>
            </Card>
          ))}
        </div>
      </Section>
    </MarketingShell>
  );
}
