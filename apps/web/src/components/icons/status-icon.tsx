type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

interface StatusIconProps {
  category: StatusCategory;
  color?: string;
  size?: number;
  className?: string;
}

const defaultColors: Record<StatusCategory, string> = {
  triage: "var(--color-status-triage)",
  backlog: "var(--color-status-backlog)",
  unstarted: "var(--color-status-unstarted)",
  started: "var(--color-status-started)",
  completed: "var(--color-status-completed)",
  canceled: "var(--color-status-canceled)",
};

const labels: Record<StatusCategory, string> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  canceled: "Canceled",
};

export function StatusIcon({
  category,
  color,
  size = 16,
  className,
}: StatusIconProps) {
  const fill = color ?? defaultColors[category];
  const label = labels[category];

  switch (category) {
    case "backlog":
      // Matches Linear's backlog status glyph.
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill={fill}
          role="img"
          aria-label={label}
          className={className}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="m14.94 8.914-1.982-.258a5 5 0 0 0 0-1.312l1.983-.258a7 7 0 0 1 0 1.828M14.47 5.32a7 7 0 0 0-.915-1.581l-1.586 1.218q.4.52.653 1.13zm-2.207-2.874-1.22 1.586a5 5 0 0 0-1.129-.653l.767-1.848c.569.236 1.1.545 1.582.915M8.914 1.06l-.258 1.983a5 5 0 0 0-1.312 0L7.086 1.06a7 7 0 0 1 1.828 0m-3.594.472.767 1.848a5 5 0 0 0-1.13.653L3.74 2.446a7 7 0 0 1 1.581-.915M2.446 3.74l1.586 1.218a5 5 0 0 0-.653 1.13L1.53 5.32a7 7 0 0 1 .915-1.581M1.06 7.086a7 7 0 0 0 0 1.828l1.983-.258a5 5 0 0 1 0-1.312zm.472 3.594 1.848-.767q.254.61.653 1.13l-1.586 1.219a7 7 0 0 1-.915-1.582m2.208 2.874 1.218-1.586q.52.4 1.13.653L5.32 14.47a7 7 0 0 1-1.581-.915m3.347 1.387.258-1.983a5 5 0 0 0 1.312 0l.258 1.983a7 7 0 0 1-1.828 0m3.594-.472-.767-1.848a5 5 0 0 0 1.13-.653l1.219 1.586a7 7 0 0 1-1.582.915m2.874-2.207-1.586-1.22c.265-.344.485-.723.653-1.129l1.848.767a7 7 0 0 1-.915 1.582"
          />
        </svg>
      );

    case "unstarted":
      // Matches Linear's todo status glyph.
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill={fill}
          role="img"
          aria-label={label}
          className={className}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14"
          />
        </svg>
      );

    case "started":
      // Matches Linear's started status glyph.
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill={fill}
          role="img"
          aria-label={label}
          className={className}
        >
          <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M8 4a4 4 0 0 1 0 8z" />
        </svg>
      );

    case "completed":
      // Matches Linear's completed status glyph.
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill={fill}
          role="img"
          aria-label={label}
          className={className}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m4.101 5.101a.85.85 0 1 0-1.202-1.202L6.5 9.298 5.101 7.899a.85.85 0 1 0-1.202 1.202l2 2a.85.85 0 0 0 1.202 0z"
          />
        </svg>
      );

    case "canceled":
      // Circle with X
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          role="img"
          aria-label={label}
          className={className}
        >
          <circle cx="8" cy="8" r="5.5" stroke={fill} strokeWidth="1.5" />
          <path
            d="M6 6L10 10M10 6L6 10"
            stroke={fill}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );

    case "triage":
      // Matches Linear's triage status glyph.
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill={fill}
          role="img"
          aria-label={label}
          className={className}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14m1.013-4.492V8.982H6.987v1.526c0 .421-.51.647-.838.37L3.174 8.372a.482.482 0 0 1 0-.742L6.15 5.121c.328-.276.838-.05.838.371v1.526h2.026V5.492c0-.421.51-.647.838-.37l2.975 2.507a.48.48 0 0 1 0 .742L9.85 10.879c-.328.276-.838.05-.838-.371"
          />
        </svg>
      );
  }
}
