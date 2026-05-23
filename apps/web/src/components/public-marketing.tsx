import Link from "next/link";
import type { ReactNode } from "react";

export const marketingNavLinks = [
  { href: "/homepage#product", label: "Product" },
  { href: "/homepage#resources", label: "Resources" },
  { href: "/customers", label: "Customers" },
  { href: "/pricing", label: "Pricing" },
  { href: "/changelog", label: "Now" },
  { href: "/homepage#contact", label: "Contact" },
];

export function MarketingHeader() {
  return (
    <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 text-sm sm:px-10 lg:px-12">
      <Link href="/homepage" className="flex items-center gap-3 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--editorial-ink-1)] text-[var(--editorial-bg)]">
          L
        </span>
        <span>Linear</span>
      </Link>

      <nav
        className="hidden items-center gap-6 text-[var(--editorial-ink-3)] md:flex"
        aria-label="Public marketing"
      >
        {marketingNavLinks.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className="transition-colors hover:text-[var(--editorial-ink-1)]"
          >
            {link.label}
          </Link>
        ))}
      </nav>

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
    </header>
  );
}

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen overflow-hidden bg-[var(--editorial-bg)] text-[var(--editorial-ink-1)]">
      <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(circle_at_top,rgba(113,128,255,0.22),transparent_58%)]" />
      <MarketingHeader />
      {children}
    </main>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-5 inline-flex rounded-full border border-[var(--editorial-line)] bg-[var(--editorial-surface)] px-3 py-1 text-sm text-[var(--editorial-ink-3)] shadow-[var(--editorial-shadow-sm)]">
      {children}
    </p>
  );
}

export function MarketingCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[1.5rem] border border-[var(--editorial-line)] bg-[var(--editorial-surface)] p-6 shadow-[var(--editorial-shadow-sm)]">
      {children}
    </div>
  );
}
