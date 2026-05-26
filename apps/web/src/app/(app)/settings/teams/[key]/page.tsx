"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamData {
  name: string;
  key: string;
  icon: string;
  memberCount: number;
  labelCount: number;
  statusCount: number;
  triageEnabled: boolean;
  cyclesEnabled: boolean;
  autoAssignment?: boolean;
  discussionSummariesEnabled?: boolean;
  parentTeam?: { name: string; key: string } | null;
  retiredAt?: string | null;
  deletedAt?: string | null;
  restorableUntil?: string | null;
}

function SettingsCard({
  title,
  description,
  href,
  badge,
}: {
  title: string;
  description: string;
  href: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-text-tertiary)]">
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <div>
          <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
            {title}
          </div>
          <div className="text-[12px] text-[var(--color-text-tertiary)]">
            {description}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {badge && (
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {badge}
          </span>
        )}
        <svg
          className="h-4 w-4 text-[var(--color-text-tertiary)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </div>
    </Link>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-8 text-[14px] font-semibold text-[var(--color-text-primary)]">
      {children}
    </h2>
  );
}

function DangerButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:border-red-500/50 hover:text-red-400"
    >
      {children}
    </button>
  );
}

function DangerDialog({
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive,
  loading,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <dialog
        aria-modal="true"
        aria-labelledby="team-danger-dialog-title"
        open
        className="w-full max-w-[420px] rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl"
      >
        <h2
          id="team-danger-dialog-title"
          className="text-[16px] font-semibold text-[var(--color-text-primary)]"
        >
          {title}
        </h2>
        <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-md px-3 py-1.5 text-[12px] transition-colors disabled:opacity-50 ${
              destructive
                ? "border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/15"
                : "border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            {loading ? pendingLabel : confirmLabel}
          </button>
        </div>
      </dialog>
    </div>
  );
}

const PLACEHOLDER_ROUTES = {
  members: "members",
  slackNotifications: "slack-notifications",
  labels: "labels",
  templates: "templates",
  recurring: "recurring-issues",
  workflows: "workflows",
  triage: "triage",
  cycles: "cycles",
  agents: "agents",
  discussionSummaries: "discussion-summaries",
  hierarchy: "hierarchy",
} as const;

type DangerAction = "leave" | "retire" | "delete" | "restore" | null;

export default function TeamSettingsHubPage() {
  const params = useParams();
  const router = useRouter();
  const key = params.key as string;
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dangerAction, setDangerAction] = useState<DangerAction>(null);
  const [dangerLoading, setDangerLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/teams/${key}/settings`)
      .then((res) => res.json())
      .then((data) => setTeam(data.team))
      .finally(() => setLoading(false));
  }, [key]);

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

  const teamPath = `/settings/teams/${encodeURIComponent(team.key)}`;

  const dangerCopy: Record<
    Exclude<DangerAction, null>,
    {
      title: string;
      description: string;
      confirmLabel: string;
      pendingLabel: string;
    }
  > = {
    leave: {
      title: "Leave team?",
      description: `You will lose access to ${team.name} until someone adds you back.`,
      confirmLabel: "Leave team",
      pendingLabel: "Leaving...",
    },
    retire: {
      title: "Retire team?",
      description:
        "Retiring preserves historical work while marking the team inactive and preventing new issue creation.",
      confirmLabel: "Retire team",
      pendingLabel: "Retiring...",
    },
    delete: {
      title: "Delete team?",
      description:
        "Deleting hides the team from normal navigation and schedules it for removal after a 30-day restoration window.",
      confirmLabel: "Delete team",
      pendingLabel: "Deleting...",
    },
    restore: {
      title: "Restore team?",
      description:
        "Restoring cancels scheduled deletion and returns the team to normal navigation if the 30-day window has not expired.",
      confirmLabel: "Restore team",
      pendingLabel: "Restoring...",
    },
  };

  async function handleDangerConfirm() {
    if (!dangerAction) {
      return;
    }

    setDangerLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/teams/${key}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: dangerAction }),
      });

      const data = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        redirectTo?: string;
        team?: TeamData;
      } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to complete team action");
      }

      if (data?.team) {
        setTeam(data.team);
      }

      setStatusMessage(data?.message ?? "Team action completed.");
      setDangerAction(null);

      if (data?.redirectTo) {
        router.push(data.redirectTo);
        router.refresh();
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to complete team action",
      );
    } finally {
      setDangerLoading(false);
    }
  }

  return (
    <div className="max-w-[720px]">
      {/* Team header */}
      <div className="mb-8 flex items-center gap-3">
        <span className="text-[28px]">{team.icon}</span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
              {team.name}
            </h1>
            {team.retiredAt ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                Retired
              </span>
            ) : null}
            {team.deletedAt ? (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300">
                Scheduled for deletion
              </span>
            ) : null}
          </div>
          {team.retiredAt ? (
            <p className="mt-1 text-[12px] text-amber-200">
              Historical work remains visible; new issue creation is disabled.
            </p>
          ) : null}
        </div>
      </div>

      {/* General settings cards */}
      <div className="flex flex-col gap-2">
        <SettingsCard
          title="General"
          description="Name, identifier, timezone, estimates, and broader settings"
          href={`${teamPath}/general`}
        />
        <SettingsCard
          title="Members"
          description="Manage team members"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.members}`}
          badge={`${team.memberCount} members`}
        />
        <SettingsCard
          title="Slack notifications"
          description="Broadcast notifications to Slack"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.slackNotifications}`}
        />
      </div>

      {/* Issues, projects, and docs */}
      <SectionTitle>Issues, projects, and docs</SectionTitle>
      <div className="flex flex-col gap-2">
        <SettingsCard
          title="Issue labels"
          description="Labels available to this team's issues"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.labels}`}
          badge={`${team.labelCount} labels`}
        />
        <SettingsCard
          title="Templates"
          description="Pre-filled templates for issues, documents, and projects"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.templates}`}
          badge="None"
        />
        <SettingsCard
          title="Recurring issues"
          description="Automatically create issues on a schedule"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.recurring}`}
          badge="None"
        />
      </div>

      {/* Workflow */}
      <SectionTitle>Workflow</SectionTitle>
      <div className="flex flex-col gap-2">
        <SettingsCard
          title="Issue statuses"
          description="Customize workflow statuses for this team"
          href={`${teamPath}/statuses`}
          badge={`${team.statusCount} statuses`}
        />
        <SettingsCard
          title="Workflows & automations"
          description="Git workflows, auto-assignment, and status transition rules"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.workflows}`}
        />
        <SettingsCard
          title="Triage"
          description="Enable or disable triage for incoming issues"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.triage}`}
          badge={team.triageEnabled ? "Enabled" : "Disabled"}
        />
        <SettingsCard
          title="Cycles"
          description="Focus team over time-boxed windows"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.cycles}`}
          badge={team.cyclesEnabled ? "On" : "Off"}
        />
      </div>

      {/* AI */}
      <SectionTitle>AI</SectionTitle>
      <div className="flex flex-col gap-2">
        <SettingsCard
          title="Agents"
          description="AI agent guidance for this team"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.agents}`}
          badge={team.autoAssignment ? "Auto-assign on" : "Auto-assign off"}
        />
        <SettingsCard
          title="Discussion summaries"
          description="Auto-generate AI summaries of discussions"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.discussionSummaries}`}
          badge={
            team.discussionSummariesEnabled ? "Summaries on" : "Summaries off"
          }
        />
      </div>

      {/* Team hierarchy */}
      <SectionTitle>Team hierarchy</SectionTitle>
      <div className="flex flex-col gap-2">
        <SettingsCard
          title="Parent team"
          description="Set this team as a sub-team of another team"
          href={`${teamPath}/${PLACEHOLDER_ROUTES.hierarchy}`}
          badge={team.parentTeam ? team.parentTeam.name : "None"}
        />
      </div>

      {/* Danger zone */}
      <SectionTitle>Danger zone</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <DangerButton onClick={() => setDangerAction("leave")}>
          Leave team
        </DangerButton>
        <DangerButton onClick={() => setDangerAction("retire")}>
          Retire team
        </DangerButton>
        <DangerButton onClick={() => setDangerAction("delete")}>
          Delete team
        </DangerButton>
        {team.deletedAt ? (
          <DangerButton onClick={() => setDangerAction("restore")}>
            Restore team
          </DangerButton>
        ) : null}
      </div>
      {statusMessage ? (
        <p className="mt-4 text-[12px] text-[var(--color-text-secondary)]">
          {statusMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-4 text-[12px] text-red-400">{errorMessage}</p>
      ) : null}
      {dangerAction ? (
        <DangerDialog
          title={dangerCopy[dangerAction].title}
          description={dangerCopy[dangerAction].description}
          confirmLabel={dangerCopy[dangerAction].confirmLabel}
          pendingLabel={dangerCopy[dangerAction].pendingLabel}
          destructive={dangerAction !== "retire"}
          loading={dangerLoading}
          onCancel={() => setDangerAction(null)}
          onConfirm={handleDangerConfirm}
        />
      ) : null}
    </div>
  );
}
