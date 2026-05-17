import {
  MarketingCard,
  MarketingSection,
  MarketingShell,
} from "@/components/marketing-page";

export default function CustomersPage() {
  return (
    <MarketingShell
      eyebrow="Customers"
      title="Product teams build momentum with Linear"
      description="Read customer stories from engineering, product, design, operations, and AI-forward teams using Linear as their product development system."
    >
      <MarketingSection title="Customer stories">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["OpenAI", "Why OpenAI chose Linear and scaled to 3,000 users."],
            [
              "Perplexity",
              "A fast issue-to-launch workflow for teams moving at AI speed.",
            ],
            [
              "Ramp",
              "Company-wide planning with crisp project updates and ownership.",
            ],
          ].map(([name, story]) => (
            <MarketingCard key={name}>
              <p className="text-sm uppercase tracking-[0.24em] text-[#8a7cff]">
                {name}
              </p>
              <h3 className="mt-3 text-xl font-semibold text-white">{story}</h3>
            </MarketingCard>
          ))}
        </div>
      </MarketingSection>
      <MarketingSection title="Filters">
        <p className="text-[#c9c0b6]">
          Browse by Engineering, Product, Design, Startups, Enterprise, and AI
          teams.
        </p>
      </MarketingSection>
    </MarketingShell>
  );
}
