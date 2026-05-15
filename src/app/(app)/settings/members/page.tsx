"use client";

import { Avatar } from "@/components/avatar";
import { useEffect, useState } from "react";

type WorkspaceRole = "owner" | "admin" | "member" | "guest";
type MemberKind = "member" | "invitation";

interface MemberData {
  id: string;
  kind: MemberKind;
  userId: string | null;
  name: string;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  status: "active" | "pending";
  teams: string[];
  joinedAt: string;
  lastSeenAt: string | null;
}

interface InviteDraft {
  id: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
}

interface MembersResponse {
  workspaceId: string;
  currentUserId: string;
  viewerRole: WorkspaceRole;
  canInviteMembers?: boolean;
  members: MemberData[];
}

const defaultInvite = (): InviteDraft => ({
  id:
    globalThis.crypto?.randomUUID?.() ??
    `invite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  email: "",
  role: "member",
});

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function roleLabel(role: WorkspaceRole) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function escapeCsvValue(value: string) {
  if (/["\n,]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

export default function MembersPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<WorkspaceRole>("member");
  const [canInviteMembers, setCanInviteMembers] = useState(false);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteRows, setInviteRows] = useState<InviteDraft[]>([
    defaultInvite(),
  ]);
  const [inviting, setInviting] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManageMembers = viewerRole === "owner" || viewerRole === "admin";
  const activeCount = members.filter(
    (member) => member.status === "active",
  ).length;
  const pendingCount = members.filter(
    (member) => member.status === "pending",
  ).length;

  async function loadMembers() {
    const response = await fetch("/api/workspaces/members");
    const data = (await response.json().catch(() => null)) as
      | MembersResponse
      | { error?: string }
      | null;

    if (!response.ok || !data || !("members" in data)) {
      throw new Error(
        data && "error" in data ? data.error : "Failed to load members",
      );
    }

    setWorkspaceId(data.workspaceId);
    setCurrentUserId(data.currentUserId);
    setViewerRole(data.viewerRole);
    setCanInviteMembers(
      data.canInviteMembers ??
        (data.viewerRole === "owner" || data.viewerRole === "admin"),
    );
    setMembers(data.members);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadMembers is a stable effect event used for the initial fetch only
  useEffect(() => {
    loadMembers()
      .catch(() => {
        setErrorMessage("Unable to load workspace members.");
      })
      .finally(() => setLoading(false));
  }, []);

  function updateInviteRow(index: number, patch: Partial<InviteDraft>) {
    setInviteRows((currentRows) =>
      currentRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  function addInviteRow() {
    setInviteRows((currentRows) => [...currentRows, defaultInvite()]);
  }

  function removeInviteRow(index: number) {
    setInviteRows((currentRows) =>
      currentRows.length === 1
        ? currentRows
        : currentRows.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  async function handleInviteSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invites = inviteRows
      .filter((invite) => invite.email.trim())
      .map(({ email, role }) => ({
        email,
        role,
      }));
    if (invites.length === 0) {
      return;
    }

    setInviting(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/workspaces/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId,
          invites,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        results?: {
          email: string;
          status: "sent" | "failed";
          error?: string;
        }[];
      } | null;

      if (!response.ok) {
        setErrorMessage(data?.error ?? "Unable to send invitations.");
        return;
      }

      const failures =
        data?.results?.filter((result) => result.status === "failed") ?? [];
      if (failures.length > 0) {
        setErrorMessage(
          failures
            .map(
              (failure) =>
                `${failure.email}: ${failure.error ?? "Failed to send"}`,
            )
            .join(" "),
        );
        return;
      }

      setInviteDialogOpen(false);
      setInviteRows([defaultInvite()]);
      setStatusMessage(
        `Sent ${invites.length} invitation${invites.length === 1 ? "" : "s"}.`,
      );
      await loadMembers();
    } catch {
      setErrorMessage("Unable to send invitations.");
    } finally {
      setInviting(false);
    }
  }

  async function updateRole(memberEntry: MemberData, role: WorkspaceRole) {
    const previousMembers = members;
    setSavingRoleId(memberEntry.id);
    setErrorMessage(null);
    setStatusMessage(null);
    setMembers((currentMembers) =>
      currentMembers.map((currentMember) =>
        currentMember.id === memberEntry.id
          ? { ...currentMember, role }
          : currentMember,
      ),
    );

    try {
      const response = await fetch("/api/workspaces/members", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: memberEntry.id,
          kind: memberEntry.kind,
          role,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setMembers(previousMembers);
        setErrorMessage(data?.error ?? "Unable to update member role.");
        return;
      }

      setStatusMessage("Member role updated.");
      await loadMembers();
    } catch {
      setMembers(previousMembers);
      setErrorMessage("Unable to update member role.");
    } finally {
      setSavingRoleId(null);
    }
  }

  function exportCsv() {
    const rows = [
      ["Name", "Email", "Role", "Status", "Teams", "Joined", "Last seen"],
      ...members.map((member) => [
        member.status === "pending" ? "" : member.name,
        member.email,
        roleLabel(member.role),
        member.status === "active" ? "Active" : "Pending",
        member.teams.join(", "),
        formatDate(member.joinedAt),
        formatDate(member.lastSeenAt),
      ]),
    ];

    const csv = rows
      .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "workspace-members.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusMessage("Exported members CSV.");
    setErrorMessage(null);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
          Members
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setInviteDialogOpen(true);
              setErrorMessage(null);
              setStatusMessage(null);
            }}
            disabled={!canInviteMembers}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Invite
          </button>
        </div>
      </div>

      {statusMessage ? (
        <p className="mb-4 text-[12px] text-green-400">{statusMessage}</p>
      ) : null}
      {errorMessage ? (
        <p className="mb-4 text-[12px] text-red-400">{errorMessage}</p>
      ) : null}

      <div className="mb-4 flex items-center gap-4 border-b border-[var(--color-border)] pb-2">
        <button
          type="button"
          className="text-[13px] font-medium text-[var(--color-text-primary)]"
          data-active="true"
        >
          All
        </button>
        <div className="flex items-center gap-3 text-[12px] text-[var(--color-text-tertiary)]">
          <span>
            Active{" "}
            <span className="font-medium text-[var(--color-text-secondary)]">
              {activeCount}
            </span>
          </span>
          <span>
            Invited{" "}
            <span className="font-medium text-[var(--color-text-secondary)]">
              {pendingCount}
            </span>
          </span>
        </div>
      </div>

      <div className="flex h-[32px] items-center border-b border-[var(--color-border)] text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
        <div className="min-w-0 flex-1 px-4">Name</div>
        <div className="w-[180px] shrink-0">Email</div>
        <div className="w-[80px] shrink-0">Status</div>
        <div className="w-[120px] shrink-0">Teams</div>
        <div className="w-[100px] shrink-0">Joined</div>
        <div className="w-[100px] shrink-0">Last seen</div>
      </div>

      {members.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-[var(--color-text-tertiary)]">
          No members yet. Invite your team to get started.
        </div>
      ) : (
        <div>
          {members.map((memberEntry) => {
            const isSelf = Boolean(
              currentUserId && memberEntry.userId === currentUserId,
            );
            const canEditRole =
              canManageMembers &&
              !isSelf &&
              !(viewerRole !== "owner" && memberEntry.role === "owner");

            return (
              <div
                key={memberEntry.id}
                className="flex h-[52px] items-center border-b border-[var(--color-border)] text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
                  <Avatar
                    name={
                      memberEntry.status === "pending"
                        ? memberEntry.email
                        : memberEntry.name
                    }
                    src={memberEntry.image ?? undefined}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[var(--color-text-primary)]">
                      {memberEntry.status === "pending"
                        ? "Pending invite"
                        : memberEntry.name}
                    </div>
                    {canEditRole ? (
                      <select
                        aria-label={`Role for ${memberEntry.email}`}
                        value={memberEntry.role}
                        disabled={savingRoleId === memberEntry.id}
                        onChange={(event) =>
                          void updateRole(
                            memberEntry,
                            event.target.value as WorkspaceRole,
                          )
                        }
                        className="mt-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]"
                      >
                        {viewerRole === "owner" ? (
                          <option value="owner">Owner</option>
                        ) : null}
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="guest">Guest</option>
                      </select>
                    ) : (
                      <span className="mt-1 inline-block rounded bg-[var(--color-surface-active)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                        {roleLabel(memberEntry.role)}
                        {isSelf ? " (you)" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-[180px] shrink-0 truncate text-[var(--color-text-secondary)]">
                  {memberEntry.email}
                </div>
                <div className="w-[80px] shrink-0">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      memberEntry.status === "active"
                        ? "bg-green-500/10 text-green-400"
                        : "bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {memberEntry.status === "active" ? "Active" : "Pending"}
                  </span>
                </div>
                <div className="w-[120px] shrink-0 truncate text-[12px] text-[var(--color-text-tertiary)]">
                  {memberEntry.teams.join(", ") || "—"}
                </div>
                <div className="w-[100px] shrink-0 text-[12px] text-[var(--color-text-tertiary)]">
                  {formatDate(memberEntry.joinedAt)}
                </div>
                <div className="w-[100px] shrink-0 text-[12px] text-[var(--color-text-tertiary)]">
                  {formatDate(memberEntry.lastSeenAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {inviteDialogOpen ? (
        <dialog
          open
          aria-modal="true"
          aria-label="Invite members"
          className="fixed inset-0 z-50 flex max-h-none max-w-none items-center justify-center bg-black/60 p-4"
        >
          <form
            onSubmit={(event) => void handleInviteSubmit(event)}
            className="w-full max-w-[520px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
                  Invite members
                </h2>
                <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                  Send workspace invitations and set each person&apos;s role
                  before they join.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInviteDialogOpen(false);
                  setInviteRows([defaultInvite()]);
                }}
                className="rounded-md p-2 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                aria-label="Close invite dialog"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              {inviteRows.map((invite, index) => (
                <div key={invite.id} className="flex items-center gap-2">
                  <input
                    type="email"
                    value={invite.email}
                    onChange={(event) =>
                      updateInviteRow(index, { email: event.target.value })
                    }
                    placeholder="teammate@company.com"
                    className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-sidebar-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-accent)]"
                  />
                  <select
                    aria-label={`Invitation role ${index + 1}`}
                    value={invite.role}
                    onChange={(event) =>
                      updateInviteRow(index, {
                        role: event.target.value as InviteDraft["role"],
                      })
                    }
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-sidebar-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="guest">Guest</option>
                  </select>
                  {inviteRows.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeInviteRow(index)}
                      className="rounded-md p-2 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                      aria-label="Remove invite"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addInviteRow}
              className="mt-3 text-[13px] text-[var(--color-accent)] transition-opacity hover:opacity-80"
            >
              Add another
            </button>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setInviteDialogOpen(false);
                  setInviteRows([defaultInvite()]);
                }}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  inviting || inviteRows.every((invite) => !invite.email.trim())
                }
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {inviting ? "Sending..." : "Send invitations"}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
