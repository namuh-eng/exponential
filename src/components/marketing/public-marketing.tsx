import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/homepage", label: "Product" },
  { href: "/changelog", label: "Resources" },
  { href: "/customers", label: "Customers" },
  { href: "/pricing", label: "Pricing" },
  { href: "/changelog", label: "Now" },
  { href: "/login", label: "Contact" },
];

export function MarketingShell({
  children,
  eyebrow,
}: {
  children: ReactNode;
  eyebrow?: string;
}) {
  return (
    <main className="min-h-screen overflow-hidden bg-[var(--editorial-bg)] text-[var(--editorial-ink-1)]">
      <div className="absolute inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(circle_at_top,rgba(113,128,255,0.24),transparent_60%)]" />
      <section className="mx-auto w-full max-w-7xl px-6 py-8 sm:px-10 lg:px-12">
        <nav
          className="flex items-center justify-between gap-5 text-sm"
          aria-label="Public"
        >
          <Link
            href="/homepage"
            className="flex items-center gap-3 font-semibold"
          >
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-lg bg-[var(--editorial-ink-1)] text-[var(--editorial-bg)]"
            >
              L
            </span>
            <span>Linear</span>
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <Link
                key={`${item.label}-${item.href}`}
                href={item.href}
                className="rounded-full px-3 py-2 text-[var(--editorial-ink-3)] transition-colors hover:bg-[var(--editorial-hover)] hover:text-[var(--editorial-ink-1)]"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-[var(--editorial-ink-2)] transition-colors hover:bg-[var(--editorial-hover)]"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-[var(--editorial-ink-1)] px-4 py-2 font-medium text-[var(--editorial-bg)] transition-opacity hover:opacity-85"
            >
              Sign up
            </Link>
          </div>
        </nav>
        {eyebrow ? (
          <p className="mt-16 inline-flex rounded-full border border-[var(--editorial-line)] bg-[var(--editorial-surface)] px-3 py-1 text-sm text-[var(--editorial-ink-3)] shadow-[var(--editorial-shadow-sm)]">
            {eyebrow}
          </p>
        ) : null}
        {children}
      </section>
    </main>
  );
}

export function MarketingCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[1.75rem] border border-[var(--editorial-line)] bg-[var(--editorial-surface)] p-6 shadow-[var(--editorial-shadow-sm)] ${className}`}
    >
      {children}
    </section>
  );
}
