import {
  MarketingCard,
  MarketingShell,
} from "@/components/marketing/public-marketing";

const posts = [
  [
    "May 14, 2026",
    "Code Intelligence",
    "Linear's public Now feed highlights agent-aware code context, smarter issue linking, and faster product decisions.",
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
  title: "Changelog | Linear clone",
  description: "Public Now and changelog feed for the Linear clone.",
};

export default function ChangelogPage() {
  return (
    <MarketingShell eyebrow="Now / Changelog">
      <div className="py-14">
        <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-none tracking-[-0.05em] sm:text-6xl">
          The latest from Linear product development
        </h1>
        <div className="mt-8 flex flex-wrap gap-3">
          <label className="sr-only" htmlFor="changelog-search">
            Search changelog
          </label>
          <input
            id="changelog-search"
            placeholder="Search changelog"
            className="min-w-64 rounded-full border border-[var(--editorial-line)] bg-[var(--editorial-surface)] px-4 py-2 text-sm outline-none"
          />
          {["Product", "Agents", "Integrations"].map((filter) => (
            <button
              key={filter}
              type="button"
              className="rounded-full border border-[var(--editorial-line)] bg-[var(--editorial-surface)] px-4 py-2 text-sm"
            >
              {filter}
            </button>
          ))}
        </div>
        <div className="mt-10 space-y-5">
          {posts.map(([date, title, copy]) => (
            <MarketingCard key={title}>
              <p className="text-sm text-[var(--editorial-ink-4)]">{date}</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
                {title}
              </h2>
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
