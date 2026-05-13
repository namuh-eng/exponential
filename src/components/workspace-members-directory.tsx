import type { WorkspaceDirectoryMember } from "@/lib/workspace-directory";

function getInitials(name: string, email: string) {
  const source = name.trim() || email.trim();
  return (
    source
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function formatRole(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function WorkspaceMembersDirectory({
  members,
}: {
  members: WorkspaceDirectoryMember[];
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
              Members
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Browse everyone who belongs to this workspace and the teams they
              work with.
            </p>
          </div>
          <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-text-secondary)]">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </header>

        {members.length === 0 ? (
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
            No workspace members found.
          </section>
        ) : (
          <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)]">
            {members.map((member) => (
              <article
                key={member.id}
                className="flex items-center gap-4 border-b border-[var(--color-border)] px-5 py-4 last:border-b-0"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-hover)] text-sm font-semibold text-[var(--color-text-primary)]">
                  {member.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.image}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    getInitials(member.name, member.email)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {member.name || member.email}
                    </h2>
                    <span className="rounded-md bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">
                      {formatRole(member.role)}
                    </span>
                  </div>
                  <p className="truncate text-sm text-[var(--color-text-secondary)]">
                    {member.email}
                  </p>
                </div>
                <div className="hidden max-w-xs flex-wrap justify-end gap-1 sm:flex">
                  {member.teams.length > 0 ? (
                    member.teams.map((team) => (
                      <span
                        key={team.id}
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)]"
                      >
                        {team.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      No teams
                    </span>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
