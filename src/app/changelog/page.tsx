import {
  MarketingCard,
  MarketingSection,
  MarketingShell,
} from "@/components/marketing-page";

export default function ChangelogPage() {
  return (
    <MarketingShell
      eyebrow="Now / Changelog"
      title="What’s new in Linear"
      description="Follow the public product feed for launches, workflow improvements, integrations, and agent-focused updates."
    >
      <MarketingSection title="Latest updates">
        <div className="grid gap-4">
          {[
            [
              "May 14, 2026",
              "Code Intelligence",
              "Richer context for agents and developers working across issues, projects, and code.",
            ],
            [
              "May 7, 2026",
              "Project updates",
              "Sharper status reports, owner prompts, and timeline visibility.",
            ],
            [
              "April 30, 2026",
              "Triage improvements",
              "Faster routing for customer requests and team inboxes.",
            ],
          ].map(([date, title, body]) => (
            <MarketingCard key={title}>
              <p className="text-sm text-[#8a7cff]">{date}</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">
                {title}
              </h3>
              <p className="mt-3 text-[#c9c0b6]">{body}</p>
            </MarketingCard>
          ))}
        </div>
      </MarketingSection>
    </MarketingShell>
  );
}
