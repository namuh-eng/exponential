import { Avatar } from "@/components/avatar";
import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
} from "date-fns";

interface TriageIssue {
  id: string;
  identifier: string;
  title: string;
  creatorName: string;
  creatorImage: string | null;
  createdAt: string;
  priority: string;
  labels: { name: string; color: string }[];
}

interface TriageRowProps {
  issue: TriageIssue;
  selected?: boolean;
  onSelect: (issueId: string) => void;
  onAccept: (issueId: string) => void;
  onDecline: (issueId: string) => void;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const minuteDiff = differenceInMinutes(now, date);

  if (minuteDiff < 1) {
    return "just now";
  }

  if (minuteDiff < 60) {
    return `${minuteDiff}m ago`;
  }

  const hourDiff = differenceInHours(now, date);
  if (hourDiff < 24) {
    return `${hourDiff}h ago`;
  }

  const dayDiff = differenceInDays(now, date);
  if (dayDiff < 30) {
    return `${dayDiff}d ago`;
  }

  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function TriageRow({
  issue,
  selected = false,
  onSelect,
  onAccept,
  onDecline,
}: TriageRowProps) {
  return (
    <div
      className={`group flex items-center gap-3 border-b border-[var(--color-border)] pr-4 transition-colors hover:bg-[var(--color-surface-hover)] focus-within:bg-[var(--color-surface-hover)] ${
        selected
          ? "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] shadow-[inset_3px_0_0_var(--color-accent)]"
          : ""
      }`}
    >
      <button
        type="button"
        data-testid="triage-row"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(issue.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSelect(issue.id);
          }
        }}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-2.5 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-accent)]"
      >
        {/* Triage status icon */}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="var(--color-status-triage)"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
          </svg>
        </span>

        {/* Identifier */}
        <span className="shrink-0 text-[13px] text-[var(--color-text-secondary)]">
          {issue.identifier}
        </span>

        {/* Title */}
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-primary)]">
          {issue.title}
        </span>

        {/* Creator */}
        <span className="flex shrink-0 items-center gap-1.5">
          <Avatar
            name={issue.creatorName}
            src={issue.creatorImage ?? undefined}
            size="sm"
          />
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {issue.creatorName}
          </span>
        </span>

        {/* Date */}
        <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">
          {formatDate(issue.createdAt)}
        </span>
      </button>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          aria-label="Accept issue"
          onClick={() => onAccept(issue.id)}
          className="flex h-6 w-6 items-center justify-center rounded text-green-400 transition-colors hover:bg-green-400/10 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-green-400/40"
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
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Decline issue"
          onClick={() => onDecline(issue.id)}
          className="flex h-6 w-6 items-center justify-center rounded text-red-400 transition-colors hover:bg-red-400/10 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-400/40"
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
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
