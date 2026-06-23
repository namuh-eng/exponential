import { ExponentialMark } from "@/components/exponential-mark";
import {
  CommandLink,
  PublicPageFrame,
  StatusChip,
  TerminalPanel,
} from "@/components/marketing/terminal-primitives";
import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/homepage", label: "Product" },
  { href: "/changelog", label: "Resources" },
  { href: "/customers", label: "Customers" },
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
    <PublicPageFrame>
      <main className="mx-auto w-full max-w-7xl px-6 py-8 sm:px-10 lg:px-12">
        <nav
          className="tty-status-bar flex-wrap justify-between border px-3 py-2"
          aria-label="Public marketing"
        >
          <Link
            href="/homepage"
            className="flex items-center gap-3 text-[var(--editorial-ink-1)] transition-colors hover:text-[var(--editorial-accent)]"
          >
            <ExponentialMark size={18} />
            <span>exponential</span>
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <Link
                key={`${item.label}-${item.href}`}
                href={item.href}
                className="border border-transparent px-3 py-1.5 text-[var(--editorial-ink-3)] transition-colors hover:border-[var(--editorial-line)] hover:bg-[var(--editorial-hover)] hover:text-[var(--editorial-ink-1)]"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CommandLink href="/pricing" className="min-h-8">
              Pricing
            </CommandLink>
            <CommandLink href="/login" variant="ghost" className="min-h-8">
              Log in
            </CommandLink>
            <CommandLink href="/signup" variant="primary" className="min-h-8">
              Sign up
            </CommandLink>
          </div>
        </nav>
        {eyebrow ? (
          <div className="mt-16">
            <StatusChip
              tone="accent"
              className="h-auto max-w-full whitespace-normal py-1 leading-relaxed"
            >
              {eyebrow}
            </StatusChip>
          </div>
        ) : null}
        {children}
      </main>
    </PublicPageFrame>
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
    <TerminalPanel className={`p-6 ${className}`}>{children}</TerminalPanel>
  );
}
