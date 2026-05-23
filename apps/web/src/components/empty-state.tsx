interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
    disabled?: boolean;
    disabledReason?: string;
  };
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div className="mx-auto my-10 flex max-w-[520px] flex-col items-center justify-center rounded-[var(--editorial-radius-lg)] border border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-surface)_78%,transparent)] px-8 py-16 text-center shadow-[var(--editorial-shadow-sm)]">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
          {icon}
        </div>
      )}
      <h3 className="text-[18px] font-medium text-[var(--color-text-primary)]">
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 max-w-[340px] text-[13px] text-[var(--color-text-secondary)]">
          {description}
        </p>
      )}
      {action &&
        (action.href ? (
          <a
            href={action.href}
            className="mt-4 rounded-md bg-[var(--color-accent)] px-4 py-[8px] text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
          >
            {action.label}
          </a>
        ) : (
          <div className="mt-4 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="rounded-md bg-[var(--color-accent)] px-4 py-[8px] text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--color-accent)]"
            >
              {action.label}
            </button>
            {action.disabled && action.disabledReason && (
              <p className="max-w-[320px] text-[12px] text-[var(--color-text-secondary)]">
                {action.disabledReason}
              </p>
            )}
          </div>
        ))}
    </div>
  );
}
