"use client";

import type { WorkspaceDirectoryMember } from "@/lib/workspace-directory";
import { useMemo, useState } from "react";

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

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

function matchesMember(member: WorkspaceDirectoryMember, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    member.name,
    member.email,
    member.role,
    member.pronouns,
    member.title,
    member.location,
    member.timezone,
    ...member.teams.flatMap((team) => [team.name, team.key]),
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function WorkspaceMembersDirectory({
  members,
}: {
  members: WorkspaceDirectoryMember[];
}) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  const roles = useMemo(
    () => Array.from(new Set(members.map((member) => member.role))).sort(),
    [members],
  );
  const teams = useMemo(
    () =>
      Array.from(
        new Map(
          members.flatMap((member) =>
            member.teams.map((team) => [team.id, team] as const),
          ),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  );

  const visibleMembers = members.filter(
    (member) =>
      matchesMember(member, query) &&
      (roleFilter === "all" || member.role === roleFilter) &&
      (teamFilter === "all" ||
        member.teams.some((team) => team.id === teamFilter)),
  );
  const selectedMember =
    members.find((member) => member.id === selectedMemberId) ?? null;

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

        <section className="mb-4 grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4 md:grid-cols-[1fr_auto_auto]">
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
            Search members
            <input
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, email, role, or team"
              type="search"
              value={query}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
            Role
            <select
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              onChange={(event) => setRoleFilter(event.target.value)}
              value={roleFilter}
            >
              <option value="all">All roles</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {formatRole(role)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
            Team
            <select
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              onChange={(event) => setTeamFilter(event.target.value)}
              value={teamFilter}
            >
              <option value="all">All teams</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        </section>

        {members.length === 0 ? (
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
            No workspace members found.
          </section>
        ) : visibleMembers.length === 0 ? (
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
            No members match your search or filters.
          </section>
        ) : (
          <section
            aria-label="Workspace members"
            className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)]"
          >
            {visibleMembers.map((member) => (
              <button
                aria-label={`Open profile for ${member.name || member.email}`}
                className="flex w-full items-center gap-4 border-b border-[var(--color-border)] px-5 py-4 text-left last:border-b-0 hover:bg-[var(--color-surface-hover)] focus:bg-[var(--color-surface-hover)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-accent)]"
                key={member.id}
                onClick={() => setSelectedMemberId(member.id)}
                type="button"
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
                    {member.title || member.email}
                  </p>
                  {member.title ? (
                    <p className="truncate text-xs text-[var(--color-text-tertiary)]">
                      {member.email}
                    </p>
                  ) : null}
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
              </button>
            ))}
          </section>
        )}
      </div>

      {selectedMember ? (
        <dialog
          aria-labelledby="member-profile-title"
          className="fixed inset-0 z-50 flex h-auto max-h-none w-auto max-w-none items-center justify-center bg-black/40 p-4"
          open
        >
          <section className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                  Member profile
                </p>
                <h2
                  className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]"
                  id="member-profile-title"
                >
                  {selectedMember.name || selectedMember.email}
                </h2>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  {selectedMember.email}
                </p>
              </div>
              <button
                className="rounded-md border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                onClick={() => setSelectedMemberId(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--color-text-tertiary)]">Role</dt>
                <dd className="mt-1 font-medium text-[var(--color-text-primary)]">
                  {formatRole(selectedMember.role)}
                </dd>
              </div>
              {selectedMember.pronouns ? (
                <div>
                  <dt className="text-[var(--color-text-tertiary)]">
                    Pronouns
                  </dt>
                  <dd className="mt-1 font-medium text-[var(--color-text-primary)]">
                    {selectedMember.pronouns}
                  </dd>
                </div>
              ) : null}
              {selectedMember.title ? (
                <div>
                  <dt className="text-[var(--color-text-tertiary)]">
                    Role or title
                  </dt>
                  <dd className="mt-1 font-medium text-[var(--color-text-primary)]">
                    {selectedMember.title}
                  </dd>
                </div>
              ) : null}
              {selectedMember.location ? (
                <div>
                  <dt className="text-[var(--color-text-tertiary)]">
                    Location
                  </dt>
                  <dd className="mt-1 font-medium text-[var(--color-text-primary)]">
                    {selectedMember.location}
                  </dd>
                </div>
              ) : null}
              {selectedMember.showLocalTime && selectedMember.timezone ? (
                <div>
                  <dt className="text-[var(--color-text-tertiary)]">
                    Local time
                  </dt>
                  <dd className="mt-1 font-medium text-[var(--color-text-primary)]">
                    {new Intl.DateTimeFormat("en", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: selectedMember.timezone,
                      timeZoneName: "short",
                    }).format(new Date())}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-[var(--color-text-tertiary)]">Joined</dt>
                <dd className="mt-1 font-medium text-[var(--color-text-primary)]">
                  {formatDate(selectedMember.joinedAt)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[var(--color-text-tertiary)]">Teams</dt>
                <dd className="mt-2 flex flex-wrap gap-2">
                  {selectedMember.teams.length > 0 ? (
                    selectedMember.teams.map((team) => (
                      <a
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                        href={`/team/${team.key}/all`}
                        key={team.id}
                      >
                        {team.name}
                      </a>
                    ))
                  ) : (
                    <span className="text-[var(--color-text-secondary)]">
                      No teams assigned
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
              <a
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                href="/settings/members"
              >
                Manage members
              </a>
              <a
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                href={`mailto:${selectedMember.email}`}
              >
                Email member
              </a>
            </div>
          </section>
        </dialog>
      ) : null}
    </main>
  );
}
