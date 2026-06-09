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
    <div className="tty-status-bar sticky top-0 z-10 h-8 border-b px-3">
      <span aria-hidden="true" className="text-[var(--color-text-tertiary)]">
        ::
      </span>
      <StatusIcon category={statusCategory} color={statusColor} size={14} />
      <span className="editorial-section-title">{name}</span>
      <span className="tty-chip">{count}</span>
      <div className="flex-1" />
      <button
        type="button"
        aria-label="Add issue"
        onClick={onAddIssue}
        className="tty-row flex h-6 w-6 items-center justify-center text-[var(--color-text-secondary)] opacity-60 transition-opacity hover:text-[var(--color-text-primary)] focus:opacity-100 group-hover:opacity-100"
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
