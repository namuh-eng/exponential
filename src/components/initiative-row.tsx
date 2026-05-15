"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { InitiativeHealthBadge } from "@/components/initiative-health-badge";
import { InitiativeStatusBadge } from "@/components/initiative-status-badge";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import Link from "next/link";

interface InitiativeData {
  id: string;
  name: string;
  description?: string | null;
  status: "active" | "planned" | "completed";
  owner?: { id: string; name: string; image: string | null } | null;
  teams?: { id: string; name: string; key: string; icon: string | null }[];
  targetDate?: string | null;
  health?: "onTrack" | "atRisk" | "offTrack" | "unknown";
  latestUpdate?: {
    id: string;
    body: string;
    health: "onTrack" | "atRisk" | "offTrack";
    createdAt: string;
  } | null;
  activeProjectHealthRollup?: {
    total: number;
    withUpdates: number;
    withoutUpdates: number;
    paused: number;
  };
  projectCount: number;
  completedProjectCount: number;
}

interface InitiativeRowProps {
  initiative: InitiativeData;
}

function formatTargetDate(value?: string | null) {
  if (!value) {
    return "No target";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function InitiativeRow({ initiative }: InitiativeRowProps) {
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const href = withWorkspaceSlug(
    `/initiatives/${initiative.id}`,
    workspaceSlug,
  );
  const rollup = initiative.activeProjectHealthRollup ?? {
    total: 0,
    withUpdates: 0,
    withoutUpdates: 0,
    paused: 0,
  };

  return (
    <Link
      href={href}
      data-testid="initiative-row"
      aria-label={`${initiative.name} initiative roadmap row`}
      className="grid grid-cols-[minmax(220px,2fr)_minmax(160px,1.3fr)_120px_120px_150px_125px_170px_150px] items-center gap-4 border-b border-[var(--color-border)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <div className="min-w-0">
        <span className="block truncate text-[14px] font-medium text-[var(--color-text-primary)]">
          {initiative.name}
        </span>
        <span className="block truncate text-[12px] text-[var(--color-text-tertiary)]">
          {initiative.description || "No summary yet"}
        </span>
      </div>

      <div className="min-w-0 text-[12px] text-[var(--color-text-secondary)]">
        <span className="block truncate font-medium text-[var(--color-text-primary)]">
          Summary
        </span>
        <span className="block truncate">
          {initiative.latestUpdate?.body ??
            initiative.description ??
            "Add an initiative update or document"}
        </span>
      </div>

      <div className="min-w-0 text-[12px] text-[var(--color-text-secondary)]">
        <span className="block text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Owner
        </span>
        <span className="truncate">
          {initiative.owner?.name ?? "Unassigned"}
        </span>
      </div>

      <div className="min-w-0 text-[12px] text-[var(--color-text-secondary)]">
        <span className="block text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Teams
        </span>
        <span className="truncate">
          {initiative.teams?.length
            ? initiative.teams.map((team) => team.key).join(", ")
            : "No teams"}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-[12px] text-[var(--color-text-secondary)]">
          {initiative.completedProjectCount} / {initiative.projectCount}{" "}
          projects
        </span>
        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--color-border)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all"
            style={{
              width: `${
                initiative.projectCount > 0
                  ? Math.round(
                      (initiative.completedProjectCount /
                        initiative.projectCount) *
                        100,
                    )
                  : 0
              }%`,
            }}
          />
        </div>
      </div>

      <div className="text-[12px] text-[var(--color-text-secondary)]">
        <span className="block text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Target
        </span>
        {formatTargetDate(initiative.targetDate)}
      </div>

      <div className="flex items-center gap-2">
        <InitiativeHealthBadge health={initiative.health ?? "unknown"} />
        <InitiativeStatusBadge status={initiative.status} />
      </div>

      <div className="min-w-0 text-[12px] text-[var(--color-text-secondary)]">
        <span className="block text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Active projects
        </span>
        <span className="truncate">
          {rollup.total === 0
            ? "No active projects"
            : `${rollup.withUpdates}/${rollup.total} with updates${rollup.paused ? `, ${rollup.paused} paused` : ""}`}
        </span>
      </div>
    </Link>
  );
}
