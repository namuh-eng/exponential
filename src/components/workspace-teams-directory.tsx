import type { WorkspaceDirectoryTeam } from "@/lib/workspace-directory";
import Link from "next/link";

export function WorkspaceTeamsDirectory({
  teams,
}: {
  teams: WorkspaceDirectoryTeam[];
}) {
  return (
    <main className="h-full overflow-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <header className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
              Workspace directory
            </p>
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
              Teams
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Browse all teams in this workspace and jump into their issues.
            </p>
          </div>
          <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-text-secondary)]">
            {teams.length} {teams.length === 1 ? "team" : "teams"}
          </span>
        </header>

        {teams.length === 0 ? (
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
            No workspace teams found.
          </section>
        ) : (
          <section className="grid gap-3 sm:grid-cols-2">
            {teams.map((team) => (
              <Link
                key={team.id}
                href={`/team/${encodeURIComponent(team.key)}/all`}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-5 transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-hover)] text-sm font-semibold text-[var(--color-text-primary)]">
                      {team.icon || team.key.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                        {team.name}
                      </h2>
                      <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
                        {team.key}
                      </p>
                    </div>
                  </div>
                  {team.isPrivate ? (
                    <span className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)]">
                      Private
                    </span>
                  ) : null}
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[var(--color-text-tertiary)]">
                      Members
                    </dt>
                    <dd className="font-medium text-[var(--color-text-primary)]">
                      {team.memberCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-tertiary)]">
                      Issues
                    </dt>
                    <dd className="font-medium text-[var(--color-text-primary)]">
                      {team.issueCount ?? 0}
                    </dd>
                  </div>
                </dl>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
