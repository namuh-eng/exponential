interface PriorityIconProps {
  priority: 0 | 1 | 2 | 3 | 4;
  size?: number;
  className?: string;
}

const priorityConfig = {
  0: { label: "No priority", color: "var(--color-priority-none)" },
  1: { label: "Urgent", color: "var(--color-priority-urgent)" },
  2: { label: "High", color: "var(--color-priority-high)" },
  3: { label: "Medium", color: "var(--color-priority-medium)" },
  4: { label: "Low", color: "var(--color-priority-low)" },
} as const;

export function PriorityIcon({
  priority,
  size = 16,
  className,
}: PriorityIconProps) {
  const config = priorityConfig[priority];

  if (priority === 1) {
    // Matches Linear's urgent priority glyph.
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill={config.color}
        role="img"
        aria-label={config.label}
        className={className}
      >
        <path
          d="M3 1C1.91067 1 1 1.91067 1 3V13C1 14.0893 1.91067 15 3 15H13C14.0893 15 15 14.0893 15 13V3C15 1.91067 14.0893 1 13 1H3ZM7 4L9 4L8.75391 8.99836H7.25L7 4ZM9 11C9 11.5523 8.55228 12 8 12C7.44772 12 7 11.5523 7 11C7 10.4477 7.44772 10 8 10C8.55228 10 9 10.4477 9 11Z"
          fill={config.color}
        />
      </svg>
    );
  }

  if (priority === 0) {
    // No priority: three horizontal dashes
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        role="img"
        aria-label={config.label}
        className={className}
      >
        <path
          d="M3 5.5h10M3 8h10M3 10.5h10"
          stroke={config.color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeOpacity="0.4"
        />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={config.color}
      role="img"
      aria-label={config.label}
      className={className}
    >
      <rect x="1.5" y="8" width="3" height="6" rx="1" fill={config.color} />
      <rect
        x="6.5"
        y="5"
        width="3"
        height="9"
        rx="1"
        fill={config.color}
        fillOpacity={priority === 4 ? "0.4" : "1"}
      />
      <rect
        x="11.5"
        y="2"
        width="3"
        height="12"
        rx="1"
        fill={config.color}
        fillOpacity={priority === 2 ? "1" : "0.4"}
      />
    </svg>
  );
}
