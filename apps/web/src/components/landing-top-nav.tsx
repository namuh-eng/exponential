import { ExponentialMark } from "@/components/exponential-mark";
import { DEMO_SESSION_URL } from "@/components/landing-marketing-data";
import { CommandLink } from "@/components/marketing/terminal-primitives";
import Link from "next/link";

const NAV_LINKS = [
  { href: DEMO_SESSION_URL, label: "demo" },
  { href: "/docs", label: "docs" },
  { href: "/self-host", label: "self-host" },
  { href: "/changelog", label: "changelog" },
] as const;

export function LandingTopNav({
  repositoryUrl,
}: {
  repositoryUrl: string | undefined;
}) {
  return (
    <header className="border-b border-[var(--editorial-line)]">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-4 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2 transition-colors hover:text-[var(--editorial-accent)]"
        >
          <ExponentialMark
            size={20}
            className="text-[var(--editorial-accent)]"
          />
          <span className="text-[13px] font-medium">exponential</span>
        </Link>
        <nav className="hidden items-center gap-6 text-[12px] sm:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="border border-transparent px-2 py-1 text-[var(--editorial-ink-3)] transition-colors hover:border-[var(--editorial-line)] hover:bg-[var(--editorial-hover)] hover:text-[var(--editorial-ink-1)]"
            >
              {link.label}
            </Link>
          ))}
          {repositoryUrl ? (
            <Link
              href={repositoryUrl}
              className="border border-transparent px-2 py-1 text-[var(--editorial-ink-3)] transition-colors hover:border-[var(--editorial-line)] hover:bg-[var(--editorial-hover)] hover:text-[var(--editorial-ink-1)]"
            >
              github
            </Link>
          ) : null}
        </nav>
        <div className="flex items-center gap-2 text-[12px] text-[var(--editorial-ink-3)]">
          <div className="hidden items-center gap-3 md:flex">
            <span aria-label="Source availability">source available</span>
            <span className="border border-[var(--editorial-line-strong)] px-2.5 py-1 text-[var(--editorial-ink-1)]">
              $ npm i -g @namuh-eng/expn-cli
            </span>
          </div>
          <CommandLink href="/pricing" className="min-h-8 px-3">
            pricing
          </CommandLink>
          <CommandLink href="/login" variant="ghost" className="min-h-8 px-3">
            log in
          </CommandLink>
        </div>
      </div>
    </header>
  );
}
