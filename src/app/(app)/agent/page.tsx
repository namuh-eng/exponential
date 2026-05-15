import Link from "next/link";

export default function AgentPage() {
  return (
    <div className="flex h-full flex-col p-8">
      <div className="max-w-[760px]">
        <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
          Agent
        </p>
        <h1 className="mt-2 text-[28px] font-semibold text-[var(--color-text-primary)]">
          Agent
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--color-text-secondary)]">
          Coordinate AI-assisted work from a dedicated workspace surface. This
          placeholder keeps the sidebar entry routable while the full Linear
          Agent workflow is implemented.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              Agent personalization
            </h2>
            <p className="mt-2 text-[13px] leading-5 text-[var(--color-text-secondary)]">
              Configure instructions and assisted workflow defaults used by AI
              agents in this workspace.
            </p>
            <Link
              href="/settings/account/agents"
              className="mt-4 inline-flex rounded-md border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Open agent settings
            </Link>
          </section>

          <section className="rounded-xl border border-dashed border-[var(--color-border)] bg-transparent p-5">
            <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              Workspace agent surface
            </h2>
            <p className="mt-2 text-[13px] leading-5 text-[var(--color-text-secondary)]">
              Upcoming work can add task queues, suggested fixes, and agent run
              history here without changing the top-level route.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
