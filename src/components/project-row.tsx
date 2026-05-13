"use client";

import { Avatar } from "@/components/avatar";
import { PriorityIcon } from "@/components/icons/priority-icon";
import Link from "next/link";

type ProjectStatus =
  | "planned"
  | "started"
  | "paused"
  | "completed"
  | "canceled";
type ProjectPriority = "none" | "urgent" | "high" | "medium" | "low";

const priorityMap: Record<string, 0 | 1 | 2 | 3 | 4> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const months = [
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
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function ProgressRing({
  progress,
  status,
}: {
  progress: number;
  status: ProjectStatus;
}) {
  const size = 18;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  const color =
    status === "completed" ? "#4caf50" : progress > 0 ? "#5E6AD2" : "#6b6f76";

  return (
    <svg width={size} height={size} className="shrink-0">
      <title>Progress</title>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export interface ProjectRowProps {
  name: string;
  icon: string | null;
  slug: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  health: string;
  lead: { name: string; image?: string } | null;
  targetDate: string | null;
  progress: number;
}

export function ProjectRow({
  name,
  icon,
  slug,
  status,
  priority,
  health,
  lead,
  targetDate,
  progress,
}: ProjectRowProps) {
  return (
    <Link
      href={`/project/${slug}/overview`}
      data-testid="project-row"
      className="group flex h-[44px] items-center border-b border-[var(--color-border)] px-4 text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      {/* Icon + Name */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-[14px]">{icon ?? "📋"}</span>
        <span className="truncate text-[var(--color-text-primary)]">
          {name}
        </span>
      </div>

      {/* Health */}
      <div className="w-[120px] shrink-0 text-[12px] text-[var(--color-text-secondary)]">
        {health}
      </div>

      {/* Priority */}
      <div className="flex w-[60px] shrink-0 items-center justify-center">
        <PriorityIcon priority={priorityMap[priority] ?? 0} size={14} />
      </div>

      {/* Lead */}
      <div
        className="flex w-[60px] shrink-0 items-center justify-center"
        data-testid="project-lead"
      >
        {lead ? (
          <Avatar name={lead.name} src={lead.image} size="sm" />
        ) : (
          <div className="h-4 w-4 shrink-0 rounded-full border border-dashed border-[var(--color-border)]" />
        )}
      </div>

      {/* Target date */}
      <div className="w-[80px] shrink-0 text-[12px] text-[var(--color-text-secondary)]">
        {targetDate ? formatDate(targetDate) : ""}
      </div>

      {/* Status (progress ring + %) */}
      <div className="flex w-[70px] shrink-0 items-center gap-1.5">
        <ProgressRing progress={progress} status={status} />
        <span className="text-[12px] text-[var(--color-text-secondary)]">
          {progress}%
        </span>
      </div>
    </Link>
  );
}
