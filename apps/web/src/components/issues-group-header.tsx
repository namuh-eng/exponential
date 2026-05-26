import { StatusIcon } from "@/components/icons/status-icon";

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

interface IssuesGroupHeaderProps {
  name: string;
  count: number;
  statusCategory: StatusCategory;
  statusColor: string;
  onAddIssue?: () => void;
}

export function IssuesGroupHeader({
  name,
  count,
  statusCategory,
  statusColor,
  onAddIssue,
}: IssuesGroupHeaderProps) {
  return (
    <div className="flex h-[36px] items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 text-[13px]">
      <StatusIcon category={statusCategory} color={statusColor} size={14} />
      <span className="editorial-section-title">{name}</span>
      <span className="text-[var(--color-text-secondary)]">{count}</span>
      <div className="flex-1" />
      <button
        type="button"
        aria-label="Add issue"
        onClick={onAddIssue}
        className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-secondary)] opacity-0 transition-opacity hover:text-[var(--color-text-primary)] group-hover:opacity-100"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </svg>
      </button>
    </div>
  );
}
