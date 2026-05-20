import {
  Card,
  Chip,
  MarketingHero,
  MarketingShell,
  Section,
} from "@/components/marketing/public-marketing";

const entries = [
  {
    date: "May 14, 2026",
    title: "Code Intelligence",
    body: "A Now update highlighting richer agent context, repository understanding, and faster handoffs from planning to implementation.",
  },
  {
    date: "April 30, 2026",
    title: "Customer requests in context",
    body: "Connect feedback to projects and issues so product teams can see demand while they plan the roadmap.",
  },
  {
    date: "April 16, 2026",
    title: "Cycle planning refinements",
    body: "Cleaner cycle views and better filters keep teams focused on the work most likely to ship next.",
  },
];

export default function ChangelogPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Now / Changelog"
        title="Latest product updates from the public changelog"
        description="Follow representative releases, platform updates, and product notes without signing in."
      />

      <Section title="Recent updates">
        <div className="mb-6 flex flex-wrap gap-3">
          <Chip>All updates</Chip>
          <Chip>Product</Chip>
          <Chip>Agents</Chip>
          <Chip>Platform</Chip>
          <Chip>Search</Chip>
        </div>
        <div className="space-y-4">
          {entries.map((entry) => (
            <Card key={entry.title}>
              <div className="grid gap-4 md:grid-cols-[11rem_1fr]">
                <p className="text-sm text-white/45">{entry.date}</p>
                <div>
                  <h2 className="font-semibold text-2xl">{entry.title}</h2>
                  <p className="mt-3 text-white/65 leading-7">{entry.body}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>
    </MarketingShell>
  );
}
