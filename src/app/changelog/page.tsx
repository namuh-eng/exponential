import {
  Eyebrow,
  MarketingCard,
  MarketingShell,
} from "@/components/public-marketing";

const entries = [
  {
    date: "May 14, 2026",
    title: "Code Intelligence",
    category: "Agents",
    body: "Linear's Now feed highlights smarter code context, agent handoffs, and faster product development loops.",
  },
  {
    date: "May 7, 2026",
    title: "Customer Requests",
    category: "Product",
    body: "Collect feedback, connect requests to issues, and keep customer context close to roadmap planning.",
  },
  {
    date: "April 29, 2026",
    title: "Project updates and insights",
    category: "Now",
    body: "Public changelog notes for launches, improvements, and workflow refinements across Linear.",
  },
];

const filters = ["All", "Now", "Product", "Agents", "Integrations"];

export const metadata = {
  title: "Now / Changelog | Exponential",
  description:
    "Public Linear-style Now and changelog feed available without authentication.",
};

export default function ChangelogPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-10 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <Eyebrow>Now / Changelog</Eyebrow>
            <h1 className="text-balance text-5xl font-semibold leading-tight tracking-[-0.05em] sm:text-6xl">
              Follow what is new in Linear
            </h1>
            <p className="mt-5 text-lg leading-8 text-[var(--editorial-ink-3)]">
              Browse a public feed of launches, product improvements, and
              agent-era development updates without signing in.
            </p>
            <label className="mt-8 block max-w-sm text-sm font-medium text-[var(--editorial-ink-3)]">
              Search changelog
              <input
                className="mt-2 w-full rounded-full border border-[var(--editorial-line-strong)] bg-[var(--editorial-surface)] px-4 py-3 text-[var(--editorial-ink-1)]"
                placeholder="Search updates"
              />
            </label>
            <div
              className="mt-5 flex flex-wrap gap-2"
              aria-label="Changelog categories"
            >
              {filters.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className="rounded-full border border-[var(--editorial-line-strong)] bg-[var(--editorial-surface)] px-4 py-2 text-sm font-medium text-[var(--editorial-ink-2)]"
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {entries.map((entry) => (
              <MarketingCard key={entry.title}>
                <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--editorial-ink-4)]">
                  <span>{entry.date}</span>
                  <span className="rounded-full bg-[var(--editorial-accent-soft)] px-3 py-1 font-medium text-[var(--editorial-accent)]">
                    {entry.category}
                  </span>
                </div>
                <h2 className="mt-4 text-3xl font-semibold">{entry.title}</h2>
                <p className="mt-3 leading-7 text-[var(--editorial-ink-3)]">
                  {entry.body}
                </p>
              </MarketingCard>
            ))}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
