import {
  MarketingCard,
  MarketingShell,
} from "@/components/marketing/public-marketing";
import {
  CommandLink,
  StatusChip,
} from "@/components/marketing/terminal-primitives";

const capabilities = [
  [
    "Plan",
    "Build roadmaps with cycles, initiatives, and project updates that keep product work moving.",
  ],
  [
    "Track",
    "Triage issues, customer requests, and engineering tasks from one fast workspace.",
  ],
  [
    "Align",
    "Connect teams and agents with shared context, notifications, and searchable history.",
  ],
];

export const metadata = {
  title: "exponential — product workspace",
  description: "Editorial marketing surface for the exponential workspace.",
};

export default function Homepage() {
  return (
    <MarketingShell eyebrow="Project and issue tracking, built for modern software teams">
      <div className="grid min-h-[78vh] items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="max-w-3xl">
          <h1 className="text-balance text-5xl font-semibold leading-none sm:text-6xl lg:text-7xl">
            Purpose-built for planning and building products
          </h1>
          <h2 className="mt-5 text-balance text-2xl font-medium text-[var(--editorial-ink-2)]">
            The product development system for teams and agents
          </h2>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-[var(--editorial-ink-3)]">
            exponential brings planning, issue tracking, customer feedback, and
            product intelligence into one focused system. Explore the public
            surface without signing in.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <CommandLink href="/signup" variant="primary">
              Start building
            </CommandLink>
            <CommandLink href="/pricing">View pricing</CommandLink>
          </div>
        </div>

        <MarketingCard className="p-0">
          <div className="border-b border-[var(--editorial-line)] bg-[var(--editorial-surface-2)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Product workspace</p>
                <p className="text-xs text-[var(--editorial-ink-4)]">
                  Roadmap · Issues · Cycles
                </p>
              </div>
              <StatusChip tone="ok">On track</StatusChip>
            </div>
          </div>
          <div className="divide-y divide-[var(--editorial-line)]">
            {capabilities.map(([title, copy], index) => (
              <div
                key={title}
                className="bg-[var(--editorial-surface)] px-4 py-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  <StatusChip tone="accent">0{index + 1}</StatusChip>
                  <span className="text-sm font-medium">{title}</span>
                </div>
                <p className="text-sm leading-6 text-[var(--editorial-ink-3)]">
                  {copy}
                </p>
              </div>
            ))}
          </div>
        </MarketingCard>
      </div>
    </MarketingShell>
  );
}
