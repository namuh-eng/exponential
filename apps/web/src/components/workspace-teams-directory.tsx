"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import type { WorkspaceDirectoryTeam } from "@/lib/workspace-directory";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import Link from "next/link";
import type { FormEvent } from "react";
import { useMemo, useState, useTransition } from "react";

type TeamsDirectoryProps = {
  teams: WorkspaceDirectoryTeam[];
  canManageTeams: boolean;
  viewerRole: string;
};

type CreatedTeam = WorkspaceDirectoryTeam;

function accessLabel(team: WorkspaceDirectoryTeam) {
  if (team.isPrivate) return "Private";
  return "Workspace";
}

function membershipLabel(team: WorkspaceDirectoryTeam) {
  if (team.retiredAt) return "Retired";
  return team.currentUserIsMember ? "Member" : "Not joined";
}

function normalizeKey(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
}

export function WorkspaceTeamsDirectory({
  teams,
  canManageTeams,
  viewerRole,
}: TeamsDirectoryProps) {
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const [directoryTeams, setDirectoryTeams] = useState(teams);
  const [query, setQuery] = useState("");
  const [accessFilter, setAccessFilter] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamKey, setTeamKey] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredTeams = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return directoryTeams.filter((team) => {
      const matchesQuery =
        !normalizedQuery ||
        team.name.toLowerCase().includes(normalizedQuery) ||
        team.key.toLowerCase().includes(normalizedQuery);
      const matchesAccess =
        accessFilter === "all" ||
        (accessFilter === "private" && team.isPrivate) ||
        (accessFilter === "workspace" && !team.isPrivate) ||
        (accessFilter === "member" && team.currentUserIsMember);

      return matchesQuery && matchesAccess;
    });
  }, [accessFilter, directoryTeams, query]);

  const teamNameById = useMemo(
    () => new Map(directoryTeams.map((team) => [team.id, team.name])),
    [directoryTeams],
  );

  const resetCreateForm = () => {
    setTeamName("");
    setTeamKey("");
    setIsPrivate(false);
    setError(null);
  };

  const closeCreateModal = () => {
    if (isPending) return;
    setShowCreateModal(false);
    resetCreateForm();
  };

  const submitCreateTeam = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: teamName,
          key: teamKey || undefined,
          isPrivate,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        team?: CreatedTeam;
        error?: string;
      };

      if (!response.ok || !data.team) {
        setError(data.error ?? "Unable to create team");
        return;
      }

      setDirectoryTeams((current) =>
        [...current, data.team as CreatedTeam].sort(
          (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
        ),
      );
      setShowCreateModal(false);
      resetCreateForm();
    });
  };

  return (
    <main className="h-full overflow-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
              Workspace directory
            </p>
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
              Teams
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Find teams, review access, and jump into issues or settings.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-text-secondary)]">
              {directoryTeams.length}{" "}
              {directoryTeams.length === 1 ? "team" : "teams"}
            </span>
            {canManageTeams ? (
              <button
                className="rounded-md bg-[var(--color-text-primary)] px-3 py-2 text-sm font-medium text-[var(--color-bg)] hover:opacity-90"
                onClick={() => setShowCreateModal(true)}
                type="button"
              >
                New team
              </button>
            ) : null}
          </div>
        </header>

        <section className="mb-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">
              Search teams
              <input
                className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-secondary)]"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or key"
                type="search"
                value={query}
              />
            </label>
            <label className="text-sm font-medium text-[var(--color-text-primary)]">
              Filter
              <select
                className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-secondary)]"
                onChange={(event) => setAccessFilter(event.target.value)}
                value={accessFilter}
              >
                <option value="all">All teams</option>
                <option value="member">My teams</option>
                <option value="workspace">Workspace access</option>
                <option value="private">Private teams</option>
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
            Signed in as a workspace {viewerRole}. Settings and creation actions
            are shown only when permitted.
          </p>
        </section>

        {filteredTeams.length === 0 ? (
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
            {directoryTeams.length === 0
              ? "No workspace teams found."
              : "No teams match your search or filters."}
          </section>
        ) : (
          <section className="grid gap-3 sm:grid-cols-2">
            {filteredTeams.map((team) => (
              <article
                className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-5 ${
                  team.parentTeamId ? "ml-6 border-l-4" : ""
                }`}
                key={team.id}
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
                      {team.parentTeamId ? (
                        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          Sub-team of{" "}
                          {teamNameById.get(team.parentTeamId) ?? "parent team"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)]">
                      {accessLabel(team)}
                    </span>
                    <span className="rounded-md bg-[var(--color-surface-hover)] px-2 py-1 text-xs text-[var(--color-text-secondary)]">
                      {membershipLabel(team)}
                    </span>
                  </div>
                </div>
                <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
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
                <div className="flex flex-wrap gap-2">
                  <Link
                    className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                    href={withWorkspaceSlug(
                      `/team/${encodeURIComponent(team.key)}/all`,
                      workspaceSlug,
                    )}
                  >
                    View issues
                  </Link>
                  {canManageTeams ? (
                    <Link
                      className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                      href={withWorkspaceSlug(
                        `/settings/teams/${encodeURIComponent(team.key)}`,
                        workspaceSlug,
                      )}
                    >
                      Settings
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </section>
        )}
      </div>

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <form
            className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6 shadow-xl"
            onSubmit={submitCreateTeam}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  New team
                </h2>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Create a workspace team with its own issue key and defaults.
                </p>
              </div>
              <button
                aria-label="Close create team"
                className="text-lg text-[var(--color-text-secondary)]"
                onClick={closeCreateModal}
                type="button"
              >
                ×
              </button>
            </div>

            <label className="mb-4 block text-sm font-medium text-[var(--color-text-primary)]">
              Team name
              <input
                className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-secondary)]"
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="Engineering"
                required
                value={teamName}
              />
            </label>

            <label className="mb-4 block text-sm font-medium text-[var(--color-text-primary)]">
              Team key
              <input
                className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm uppercase text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-secondary)]"
                maxLength={10}
                onChange={(event) =>
                  setTeamKey(normalizeKey(event.target.value))
                }
                placeholder="ENG"
                value={teamKey}
              />
              <span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">
                Leave blank to generate one from the name.
              </span>
            </label>

            <label className="mb-4 flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
              <input
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
                type="checkbox"
              />
              Private team
            </label>

            {error ? (
              <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                disabled={isPending}
                onClick={closeCreateModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-[var(--color-text-primary)] px-3 py-2 text-sm font-medium text-[var(--color-bg)] disabled:opacity-60"
                disabled={isPending}
                type="submit"
              >
                {isPending ? "Creating…" : "Create team"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
