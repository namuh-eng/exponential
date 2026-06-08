import Link from "next/link";
import type { ReactNode } from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function PublicPageFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "min-h-screen bg-[var(--editorial-bg)] font-mono text-[var(--editorial-ink-1)] antialiased",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TerminalPanel({
  children,
  className,
  header,
}: {
  children: ReactNode;
  className?: string;
  header?: ReactNode;
}) {
  return (
    <section className={cx("tty-panel overflow-hidden", className)}>
      {header ? (
        <div className="tty-status-bar justify-between border-b px-3 py-2">
          {header}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function TerminalHeader({
  label,
  meta,
}: {
  label: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <>
      <span>{label}</span>
      {meta ? (
        <span className="text-[var(--editorial-ink-4)]">{meta}</span>
      ) : null}
    </>
  );
}

export function StatusChip({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "ok" | "warn" | "err";
  className?: string;
}) {
  return (
    <span
      className={cx(
        "tty-chip",
        tone === "accent" &&
          "border-[var(--editorial-accent)] text-[var(--editorial-accent)]",
        tone === "ok" &&
          "border-transparent bg-[var(--editorial-ok-soft)] text-[var(--editorial-ok)]",
        tone === "warn" &&
          "border-transparent bg-[var(--editorial-warn-soft)] text-[var(--editorial-warn)]",
        tone === "err" &&
          "border-transparent bg-[var(--editorial-err-soft)] text-[var(--editorial-err)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function CommandLink({
  children,
  className,
  href,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  href: string;
  variant?: "default" | "primary" | "ghost";
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex min-h-9 items-center justify-center border px-4 py-2 text-[13px] font-medium transition-colors",
        variant === "primary" &&
          "border-[var(--editorial-accent)] bg-[var(--editorial-accent)] text-[var(--editorial-accent-ink)] hover:bg-[var(--editorial-accent-hover)]",
        variant === "default" &&
          "border-[var(--editorial-line-strong)] bg-[var(--editorial-surface)] text-[var(--editorial-ink-1)] hover:bg-[var(--editorial-surface-2)]",
        variant === "ghost" &&
          "border-transparent bg-transparent text-[var(--editorial-ink-2)] hover:border-[var(--editorial-line)] hover:bg-[var(--editorial-hover)]",
        className,
      )}
    >
      {children}
    </Link>
  );
}
