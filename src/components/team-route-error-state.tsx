interface TeamRouteErrorStateProps {
  teamKey: string;
  variant?: "not-found" | "error";
  message?: string;
  onRetry?: () => void;
}

export function TeamRouteErrorState({
  teamKey,
  variant = "not-found",
  message,
  onRetry,
}: TeamRouteErrorStateProps) {
  const title =
    variant === "not-found" ? "Team not found" : "Unable to load team";
  const description =
    message ??
    (variant === "not-found"
      ? `The team ${teamKey} doesn't exist or you don't have access to it.`
      : "Something went wrong while loading this team. Try again.");

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-content-bg)] text-[var(--color-text-secondary)]">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label="Team route error"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      </div>
      <h3 className="text-[15px] font-medium text-[var(--color-text-primary)]">
        {title}
      </h3>
      <p className="mt-1.5 max-w-[360px] text-[13px] text-[var(--color-text-secondary)]">
        {description}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
