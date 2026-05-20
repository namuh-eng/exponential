import { CycleProgressBar } from "@/components/cycle-progress-bar";
import { formatCycleDate } from "@/lib/cycle-utils";
import { withWorkspaceSlug } from "@/lib/workspace-paths";

interface CycleData {
  id: string;
  name: string | null;
  number: number;
  startDate: string;
  endDate: string;
  issueCount: number;
  completedIssueCount: number;
}

interface CycleRowProps {
  cycle: CycleData;
  teamKey: string;
  workspaceSlug?: string;
}

export function CycleRow({ cycle, teamKey, workspaceSlug }: CycleRowProps) {
  const displayName = cycle.name ?? `Cycle ${cycle.number}`;
  const href = withWorkspaceSlug(
    `/team/${teamKey}/cycles/${cycle.id}`,
    workspaceSlug,
  );

  return (
    <a
      href={href}
      data-testid="cycle-row"
      className="flex items-center gap-4 border-b border-[var(--color-border)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      {/* Cycle icon */}
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-text-secondary)]">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21.5 2v6h-6" />
          <path d="M2.5 22v-6h6" />
          <path d="M22 11.5A10 10 0 0 0 3.2 7.2" />
          <path d="M2 12.5a10 10 0 0 0 18.8 4.3" />
        </svg>
      </div>

      {/* Name */}
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--color-text-primary)]">
        {displayName}
      </span>

      {/* Date range */}
      <span className="shrink-0 text-[12px] text-[var(--color-text-secondary)]">
        {formatCycleDate(cycle.startDate)} — {formatCycleDate(cycle.endDate)}
      </span>

      {/* Progress */}
      <div className="shrink-0">
        <CycleProgressBar
          completed={cycle.completedIssueCount}
          total={cycle.issueCount}
        />
      </div>
    </a>
  );
}
