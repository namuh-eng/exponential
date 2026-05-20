import {
  Eyebrow,
  MarketingCard,
  MarketingShell,
} from "@/components/public-marketing";
import Link from "next/link";

const capabilities = [
  {
    title: "Plan with purpose",
    body: "Roadmaps, cycles, and initiatives keep product decisions connected to daily execution.",
  },
  {
    title: "Build with focus",
    body: "Fast issue views, triage, and keyboard-first navigation help teams protect deep work.",
  },
  {
    title: "Coordinate humans and agents",
    body: "Contextual workflows keep engineers, product partners, and AI agents moving in the same system.",
  },
];

export const metadata = {
  title: "Linear homepage | Exponential",
  description:
    "A clone-local Linear-style marketing homepage for unauthenticated visitors.",
};

export default function Homepage() {
  return (
    <MarketingShell>
      <section className="mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-7xl items-center gap-12 px-6 py-16 sm:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-12">
        <div className="max-w-3xl">
          <Eyebrow>
            Project management, purpose-built for software teams
          </Eyebrow>
          <h1 className="text-balance text-5xl font-semibold leading-[0.95] tracking-[-0.06em] sm:text-6xl lg:text-7xl">
            The product development system for teams and agents
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-[var(--editorial-ink-3)]">
            Linear connects strategy, planning, execution, and intelligence in a
            single public product surface that visitors can explore before
            signing in.
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

        <div className="rounded-[2rem] border border-[var(--editorial-line)] bg-[var(--editorial-surface)] p-4 shadow-[var(--editorial-shadow-lg)]">
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
              {capabilities.map((capability, index) => (
                <MarketingCard key={capability.title}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-full bg-[var(--editorial-accent-soft)] text-xs font-semibold text-[var(--editorial-accent)]">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium">
                      {capability.title}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-[var(--editorial-ink-3)]">
                    {capability.body}
                  </p>
                </MarketingCard>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="product"
        className="mx-auto grid max-w-7xl gap-4 px-6 pb-20 sm:px-10 md:grid-cols-3 lg:px-12"
      >
        {capabilities.map((capability) => (
          <MarketingCard key={capability.title}>
            <h2 className="text-2xl font-semibold">{capability.title}</h2>
            <p className="mt-3 leading-7 text-[var(--editorial-ink-3)]">
              {capability.body}
            </p>
          </MarketingCard>
        ))}
      </section>

      <section
        id="resources"
        className="mx-auto max-w-7xl px-6 pb-24 sm:px-10 lg:px-12"
      >
        <MarketingCard>
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm font-medium text-[var(--editorial-ink-4)]">
                Resources
              </p>
              <h2 className="mt-2 text-3xl font-semibold">
                Explore the public Linear surface
              </h2>
              <p className="mt-3 max-w-2xl leading-7 text-[var(--editorial-ink-3)]">
                Read customer stories, compare plans, and follow the Now feed
                without leaving the clone.
              </p>
            </div>
            <div id="contact" className="flex flex-wrap gap-3">
              <Link
                className="rounded-full border border-[var(--editorial-line-strong)] px-5 py-3 text-sm font-semibold"
                href="/customers"
              >
                Customers
              </Link>
              <Link
                className="rounded-full border border-[var(--editorial-line-strong)] px-5 py-3 text-sm font-semibold"
                href="/changelog"
              >
                Now
              </Link>
            </div>
          </div>
        </MarketingCard>
      </section>
    </MarketingShell>
  );
}
