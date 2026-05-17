import {
  MarketingCard,
  MarketingSection,
  MarketingShell,
} from "@/components/marketing-page";

export default function HomepagePage() {
  return (
    <MarketingShell
      eyebrow="Linear homepage"
      title="The product development system for teams and agents"
      description="Plan, build, and ship ambitious product work from one fast, opinionated workspace with issues, projects, roadmaps, cycles, and AI teammate context."
    >
      <MarketingSection title="Built for modern product teams">
        <div id="product" className="grid gap-4 md:grid-cols-3">
          {[
            [
              "Issues",
              "Track work with focused views, triage, labels, and team workflows.",
            ],
            [
              "Projects",
              "Connect strategy to execution with milestones, updates, and roadmaps.",
            ],
            ["Agents", "Give AI agents the same product context as your team."],
          ].map(([title, body]) => (
            <MarketingCard key={title}>
              <h3 className="text-xl font-semibold text-white">{title}</h3>
              <p className="mt-3 text-[#c9c0b6]">{body}</p>
            </MarketingCard>
          ))}
        </div>
      </MarketingSection>
      <MarketingSection title="Contact">
        <p id="contact" className="max-w-2xl text-[#c9c0b6]">
          Talk to sales, invite your team, or sign up to start building in the
          clone-local Linear experience.
        </p>
      </MarketingSection>
    </MarketingShell>
  );
}
