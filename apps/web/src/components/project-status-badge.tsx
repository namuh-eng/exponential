"use client";

type ProjectStatus =
  | "planned"
  | "started"
  | "paused"
  | "completed"
  | "canceled";

const statusConfig: Record<
  ProjectStatus,
  { label: string; color: string; bg: string }
> = {
  planned: { label: "Planned", color: "#6b6f76", bg: "rgba(107,111,118,0.1)" },
  started: {
    label: "In Progress",
    color: "#f0c000",
    bg: "rgba(240,192,0,0.1)",
  },
  paused: { label: "Paused", color: "#6b6f76", bg: "rgba(107,111,118,0.1)" },
  completed: {
    label: "Completed",
    color: "#4caf50",
    bg: "rgba(76,175,80,0.1)",
  },
  canceled: {
    label: "Canceled",
    color: "#6b6f76",
    bg: "rgba(107,111,118,0.1)",
  },
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const config = statusConfig[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      {config.label}
    </span>
  );
}
