import {
  Card,
  Chip,
  MarketingHero,
  MarketingShell,
  Section,
} from "@/components/marketing/public-marketing";
import Link from "next/link";

const productPillars = [
  [
    "Plan",
    "Roadmaps, initiatives, and cycles keep strategy connected to day-to-day execution.",
  ],
  [
    "Build",
    "Issues, projects, and team views give every contributor a fast, focused workspace.",
  ],
  [
    "Scale",
    "Agent guidance, customer context, and insights help teams and AI collaborators move together.",
  ],
];

export default function Homepage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Linear-inspired product system"
        title="The product development system for teams and agents"
        description="A fast, opinionated workspace for planning, building, and shipping software with the clarity of Linear and the automation surface modern teams expect."
      >
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-full bg-white px-5 py-3 font-medium text-[#08090a] hover:bg-white/90"
          >
            Start building
          </Link>
          <Link
            href="/pricing"
            className="rounded-full border border-white/15 px-5 py-3 font-medium text-white hover:bg-white/10"
          >
            View pricing
          </Link>
        </div>
      </MarketingHero>

      <Section
        title="Purpose-built for high-velocity product teams"
        description="Plan the roadmap, prioritize work, and keep execution visible without leaving the clone."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {productPillars.map(([title, body]) => (
            <Card key={title}>
              <h3 className="font-semibold text-xl">{title}</h3>
              <p className="mt-3 text-white/60 leading-7">{body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="One system for humans and agents">
        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.09] to-white/[0.03] p-8">
          <div className="flex flex-wrap gap-2">
            <Chip>Issues</Chip>
            <Chip>Cycles</Chip>
            <Chip>Projects</Chip>
            <Chip>Initiatives</Chip>
            <Chip>Agent runs</Chip>
          </div>
          <p className="mt-8 max-w-3xl text-2xl text-white/80 leading-10">
            Keep product decisions, engineering execution, and AI handoffs in
            one public-to-private information architecture with local navigation
            throughout.
          </p>
        </div>
      </Section>
    </MarketingShell>
  );
}
