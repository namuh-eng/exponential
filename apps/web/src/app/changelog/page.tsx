import {
  MarketingCard,
  MarketingShell,
} from "@/components/marketing/public-marketing";
import { StatusChip } from "@/components/marketing/terminal-primitives";

const posts = [
  [
    "May 14, 2026",
    "Code Intelligence",
    "The exponential Now feed highlights agent-aware code context, smarter issue linking, and faster product decisions.",
  ],
  [
    "May 7, 2026",
    "Customer requests inbox",
    "Collect feedback, connect it to product work, and prioritize what matters next.",
  ],
  [
    "April 30, 2026",
    "Project health summaries",
    "Concise status updates make every roadmap review easier to scan.",
  ],
];

export const metadata = {
  title: "Changelog | exponential",
  description: "Public Now and changelog feed for exponential.",
};

export default function ChangelogPage() {
  return (
    <MarketingShell eyebrow="Now / Changelog">
      <div className="py-14">
        <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-none sm:text-6xl">
          The latest from exponential product development
        </h1>
        <div className="mt-8 flex flex-wrap gap-3">
          <label className="sr-only" htmlFor="changelog-search">
            Search changelog
          </label>
          <input
            id="changelog-search"
            placeholder="Search changelog"
            className="min-w-64 border border-[var(--editorial-line)] bg-[var(--editorial-surface)] px-4 py-2 text-sm text-[var(--editorial-ink-1)] outline-none placeholder:text-[var(--editorial-ink-4)] focus:border-[var(--editorial-accent)]"
          />
          {["Product", "Agents", "Integrations"].map((filter) => (
            <button
              key={filter}
              type="button"
              className="border border-[var(--editorial-line)] bg-[var(--editorial-surface)] px-4 py-2 text-sm transition-colors hover:bg-[var(--editorial-hover)]"
            >
              {filter}
            </button>
          ))}
        </div>
        <div className="mt-10 space-y-5">
          {posts.map(([date, title, copy]) => (
            <MarketingCard key={title}>
              <StatusChip>{date}</StatusChip>
              <h2 className="mt-3 text-3xl font-semibold">{title}</h2>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--editorial-ink-3)]">
                {copy}
              </p>
            </MarketingCard>
          ))}
        </div>
      </div>
    </MarketingShell>
  );
}
