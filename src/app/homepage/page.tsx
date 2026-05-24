import {
  MarketingCard,
  MarketingShell,
} from "@/components/marketing/public-marketing";
import Link from "next/link";

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
  title: "Linear homepage | Exponential",
  description:
    "A clone-local Linear-style marketing homepage for unauthenticated visitors.",
};

export default function Homepage() {
  return (
    <MarketingShell eyebrow="Project and issue tracking, built for modern software teams">
      <div className="grid min-h-[78vh] items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="max-w-3xl">
          <h1 className="text-balance text-5xl font-semibold leading-[0.95] tracking-[-0.06em] sm:text-6xl lg:text-7xl">
            The product development system for teams and agents
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-[var(--editorial-ink-3)]">
            Linear brings planning, issue tracking, customer feedback, and
            product intelligence into one focused system. Explore the public
            clone surface without signing in.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-full bg-[var(--editorial-accent)] px-6 py-3 text-sm font-semibold text-[var(--editorial-accent-ink)] shadow-[var(--editorial-shadow-md)] transition-opacity hover:opacity-90"
            >
              Start building
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-full border border-[var(--editorial-line-strong)] bg-[var(--editorial-surface)] px-6 py-3 text-sm font-semibold text-[var(--editorial-ink-1)] transition-colors hover:bg-[var(--editorial-surface-2)]"
            >
              View pricing
            </Link>
          </div>
        </div>

        <MarketingCard className="p-4">
          <div className="rounded-[1.35rem] border border-[var(--editorial-line-soft)] bg-[var(--editorial-surface-2)] p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Product workspace</p>
                <p className="text-xs text-[var(--editorial-ink-4)]">
                  Roadmap · Issues · Cycles
                </p>
              </div>
              <span className="rounded-full bg-[var(--editorial-ok-soft)] px-3 py-1 text-xs font-medium text-[var(--editorial-ok)]">
                On track
              </span>
            </div>
            <div className="space-y-3">
              {capabilities.map(([title, copy], index) => (
                <div
                  key={title}
                  className="rounded-2xl border border-[var(--editorial-line)] bg-[var(--editorial-surface)] p-4"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-full bg-[var(--editorial-accent-soft)] text-xs font-semibold text-[var(--editorial-accent)]">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium">{title}</span>
                  </div>
                  <p className="text-sm leading-6 text-[var(--editorial-ink-3)]">
                    {copy}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </MarketingCard>
      </div>
    </MarketingShell>
  );
}
