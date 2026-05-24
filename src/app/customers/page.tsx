import {
  MarketingCard,
  MarketingShell,
} from "@/components/marketing/public-marketing";

const filters = ["All", "Startups", "Enterprise", "AI", "Design partners"];
const stories = [
  [
    "OpenAI",
    "Why OpenAI chose Linear and scaled to 3,000 users",
    "AI research and product teams coordinate fast-moving work with shared roadmaps and issue context.",
  ],
  [
    "Vercel",
    "How Vercel ships frontend infrastructure with Linear",
    "Product, engineering, and support teams keep customer feedback close to execution.",
  ],
  [
    "Cash App",
    "Operating high-trust product workflows",
    "Enterprise controls and focused planning help teams move quickly without losing clarity.",
  ],
];

export const metadata = {
  title: "Customers | Linear clone",
  description: "Public customer stories for the Linear clone.",
};

export default function CustomersPage() {
  return (
    <MarketingShell eyebrow="Customers">
      <div className="py-14">
        <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-none tracking-[-0.05em] sm:text-6xl">
          Built with the teams defining modern product development
        </h1>
        <div
          className="mt-8 flex flex-wrap gap-2"
          aria-label="Customer categories"
        >
          {filters.map((filter) => (
            <button
              key={filter}
              type="button"
              className="rounded-full border border-[var(--editorial-line)] bg-[var(--editorial-surface)] px-4 py-2 text-sm text-[var(--editorial-ink-2)]"
            >
              {filter}
            </button>
          ))}
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {stories.map(([company, title, copy]) => (
            <MarketingCard key={company}>
              <p className="text-sm font-semibold text-[var(--editorial-accent)]">
                {company}
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
                {title}
              </h2>
              <p className="mt-4 text-sm leading-6 text-[var(--editorial-ink-3)]">
                {copy}
              </p>
            </MarketingCard>
          ))}
        </div>
      </div>
    </MarketingShell>
  );
}
