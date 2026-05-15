"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

interface WorkspaceMember {
  id: string;
  kind: "member" | "invitation";
  userId: string | null;
  name: string;
  email: string;
  status: "active" | "pending";
}

export default function TeamMembersSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [team, setTeam] = useState<{ name: string } | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`/api/teams/${teamKey}/settings`).then((res) => res.json()),
      fetch(`/api/teams/${teamKey}/members`).then((res) => res.json()),
    ])
      .then(([teamData, memberData]) => {
        setTeam(teamData.team);
        setMembers(memberData.members);
      })
      .finally(() => setLoading(false));
  }, [teamKey]);

  async function loadWorkspaceMembers() {
    const response = await fetch("/api/workspaces/members");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Unable to load workspace members");
    }
    setWorkspaceMembers(data.members ?? []);
  }

  async function openAddDialog() {
    setError("");
    setMessage("");
    setSelectedUserIds([]);
    setSearch("");
    setAddDialogOpen(true);
    try {
      await loadWorkspaceMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load members");
    }
  }

  async function addSelectedMembers() {
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/teams/${teamKey}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: selectedUserIds }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to add members");
      }

      setMembers(data.members ?? []);
      setAddDialogOpen(false);
      setSelectedUserIds([]);
      setMessage("Team members updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add members");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeMember(member: TeamMember) {
    if (
      !window.confirm(`Remove ${member.name} from ${team?.name ?? "team"}?`)
    ) {
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/teams/${teamKey}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to remove member");
      }

      setMembers(data.members ?? []);
      setMessage(`${member.name} was removed from the team.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove member");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Team not found
      </div>
    );
  }

  const currentMemberIds = new Set(members.map((member) => member.userId));
  const addableMembers = workspaceMembers
    .filter(
      (workspaceMember) =>
        workspaceMember.kind === "member" &&
        workspaceMember.userId &&
        !currentMemberIds.has(workspaceMember.userId),
    )
    .filter((workspaceMember) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      return (
        workspaceMember.name.toLowerCase().includes(query) ||
        workspaceMember.email.toLowerCase().includes(query)
      );
    });

  return (
    <div className="max-w-[720px]">
      <div className="mb-6">
        <Link
          href={`/settings/teams/${encodeURIComponent(teamKey)}`}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
          Members
        </h1>
        <button
          type="button"
          onClick={openAddDialog}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Add members
        </button>
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Manage who has access to the {team.name} team.
      </p>
      {message ? (
        <output className="mt-3 block text-[13px] text-green-400">
          {message}
        </output>
      ) : null}
      {error ? (
        <p className="mt-3 text-[13px] text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-8 overflow-hidden rounded-lg border border-[var(--color-border)]">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-bottom border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-tertiary)]">
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr
                key={member.id}
                className="border-t border-[var(--color-border)] text-[var(--color-text-primary)]"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{member.name}</div>
                  <div className="text-[12px] text-[var(--color-text-tertiary)]">
                    {member.email}
                  </div>
                </td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)] capitalize">
                  {member.role}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => removeMember(member)}
                    disabled={submitting}
                    aria-label={`Remove ${member.name}`}
                    className="text-[var(--color-text-tertiary)] hover:text-red-400"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {addDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <dialog
            open
            aria-modal="true"
            aria-labelledby="add-team-members-title"
            className="w-full max-w-[520px] rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-0 text-[var(--color-text-primary)] shadow-xl"
          >
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <h2
                id="add-team-members-title"
                className="text-[16px] font-semibold"
              >
                Add members
              </h2>
              <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">
                Add existing workspace members to {team.name}.
              </p>
            </div>
            <div className="space-y-4 p-5">
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
                Search workspace members
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name or email"
                  className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <div className="max-h-[260px] overflow-y-auto rounded-lg border border-[var(--color-border)]">
                {addableMembers.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[13px] text-[var(--color-text-tertiary)]">
                    No workspace members available to add.
                  </p>
                ) : (
                  addableMembers.map((workspaceMember) => {
                    const userId = workspaceMember.userId ?? "";
                    return (
                      <label
                        key={workspaceMember.id}
                        className="flex cursor-pointer items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(userId)}
                          onChange={(event) => {
                            setSelectedUserIds((current) =>
                              event.target.checked
                                ? [...current, userId]
                                : current.filter((id) => id !== userId),
                            );
                          }}
                        />
                        <span>
                          <span className="block text-[13px] font-medium">
                            {workspaceMember.name}
                          </span>
                          <span className="block text-[12px] text-[var(--color-text-tertiary)]">
                            {workspaceMember.email}
                          </span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4">
              <button
                type="button"
                onClick={() => setAddDialogOpen(false)}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addSelectedMembers}
                disabled={selectedUserIds.length === 0 || submitting}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add selected
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
