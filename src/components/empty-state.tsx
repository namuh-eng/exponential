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
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#26262a] bg-[#18181b]">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-medium text-white">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-[320px] text-[13px] text-[#6b6f76]">
          {description}
        </p>
      )}
      {action &&
        (action.href ? (
          <a
            href={action.href}
            className="mt-4 rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF]"
          >
            {action.label}
          </a>
        ) : (
          <div className="mt-4 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#5E6AD2]"
            >
              {action.label}
            </button>
            {action.disabled && action.disabledReason && (
              <p className="max-w-[320px] text-[12px] text-[#6b6f76]">
                {action.disabledReason}
              </p>
            )}
          </div>
        ))}
    </div>
  );
}
