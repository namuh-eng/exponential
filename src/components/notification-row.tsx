"use client";

import { Avatar } from "@/components/avatar";

const ACTION_TEXT: Record<string, string> = {
  assigned: "assigned the issue to you",
  mentioned: "mentioned you",
  status_change: "changed the status",
  comment: "commented on",
  duplicate: "marked as duplicate",
};

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d`;
  const diffMo = Math.floor(diffD / 30);
  return `${diffMo}mo`;
}

interface NotificationRowProps {
  id: string;
  type: "assigned" | "mentioned" | "status_change" | "comment" | "duplicate";
  actorName: string;
  actorImage: string | null;
  issueIdentifier: string | null;
  issueTitle: string;
  readAt: string | null;
  createdAt: string;
  isSelected: boolean;
  onClick: (id: string) => void;
}

export function NotificationRow({
  id,
  type,
  actorName,
  actorImage,
  issueIdentifier,
  issueTitle,
  readAt,
  createdAt,
  isSelected,
  onClick,
}: NotificationRowProps) {
  return (
    <button
      type="button"
      data-testid="notification-row"
      aria-label={
        issueIdentifier
          ? `Open ${issueIdentifier} ${issueTitle}`
          : `Select notification ${issueTitle}`
      }
      onClick={() => onClick(id)}
      className={`flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
        isSelected
          ? "bg-[var(--color-surface-active)]"
          : readAt
            ? "hover:bg-[var(--color-surface-hover)]"
            : "bg-[color-mix(in_srgb,var(--color-accent)_10%,var(--color-surface))] hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,var(--color-surface))]"
      }`}
    >
      {/* Unread dot */}
      <div className="flex shrink-0 items-center pt-1.5">
        {readAt === null ? (
          <span
            data-testid="unread-dot"
            className="block h-2 w-2 rounded-full bg-[var(--color-accent)]"
          />
        ) : (
          <span className="block h-2 w-2" />
        )}
      </div>

      {/* Avatar */}
      <div className="shrink-0 pt-0.5">
        <Avatar name={actorName} src={actorImage ?? undefined} size="md" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 text-[13px]">
          <span className="font-medium text-[var(--color-text-primary)]">
            {actorName}
          </span>
          <span className="text-[var(--color-text-secondary)]">
            {ACTION_TEXT[type]}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px]">
          <span className="shrink-0 text-[var(--color-text-secondary)]">
            {issueIdentifier}
          </span>
          <span className="truncate text-[var(--color-text-primary)]">
            {issueTitle}
          </span>
        </div>
      </div>

      {/* Timestamp */}
      <span className="shrink-0 pt-0.5 text-[12px] text-[var(--color-text-secondary)]">
        {formatRelativeTime(createdAt)}
      </span>
    </button>
  );
}
