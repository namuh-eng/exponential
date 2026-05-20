import {
  Eyebrow,
  MarketingCard,
  MarketingShell,
} from "@/components/public-marketing";

const stories = [
  {
    company: "OpenAI",
    title: "Why OpenAI chose Linear and scaled to 3,000 users",
    body: "AI research and product teams coordinate fast-moving work with a shared product development system.",
  },
  {
    company: "Ramp",
    title: "Ramp keeps finance product launches aligned",
    body: "Product, engineering, and design teams connect roadmaps to daily execution across squads.",
  },
  {
    company: "Perplexity",
    title: "Perplexity plans launches with focused issue workflows",
    body: "A high-velocity team uses cycles, projects, and triage to keep momentum visible.",
  },
];

const filters = ["All", "AI", "Fintech", "Startups", "Enterprise"];

export const metadata = {
  title: "Customers | Exponential",
  description:
    "Public Linear-style customer stories available without authentication.",
};

export default function CustomersPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-6 py-16 sm:px-10 lg:px-12">
        <div className="max-w-3xl">
          <Eyebrow>Customers</Eyebrow>
          <h1 className="text-balance text-5xl font-semibold leading-tight tracking-[-0.05em] sm:text-6xl">
            Built with the teams defining modern software
          </h1>
          <p className="mt-5 text-lg leading-8 text-[var(--editorial-ink-3)]">
            Read representative customer stories and discover why ambitious
            teams choose Linear for planning, tracking, and shipping.
          </p>
        </div>

        <div
          className="mt-10 flex flex-wrap gap-3"
          aria-label="Customer categories"
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

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {stories.map((story) => (
            <MarketingCard key={story.company}>
              <p className="text-sm font-semibold text-[var(--editorial-accent)]">
                {story.company}
              </p>
              <h2 className="mt-4 text-3xl font-semibold leading-tight">
                {story.title}
              </h2>
              <p className="mt-4 leading-7 text-[var(--editorial-ink-3)]">
                {story.body}
              </p>
            </MarketingCard>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
