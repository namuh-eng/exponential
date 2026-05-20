import Link from "next/link";
import type { ReactNode } from "react";

const navLinks = [
  { href: "/homepage", label: "Product" },
  { href: "/changelog", label: "Resources" },
  { href: "/customers", label: "Customers" },
  { href: "/pricing", label: "Pricing" },
  { href: "/now", label: "Now" },
  { href: "mailto:hello@example.com", label: "Contact" },
];

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#08090a] text-white">
      <header className="sticky top-0 z-10 border-white/10 border-b bg-[#08090a]/90 backdrop-blur">
        <nav
          aria-label="Public marketing navigation"
          className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4"
        >
          <Link
            href="/homepage"
            className="font-semibold text-lg tracking-tight"
            aria-label="Exponential homepage"
          >
            Exponential
          </Link>
          <div className="hidden items-center gap-6 text-sm text-white/70 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/login" className="text-white/70 hover:text-white">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-white px-4 py-2 font-medium text-[#08090a] transition hover:bg-white/90"
            >
              Sign up
            </Link>
          </div>
        </nav>
      </header>
      {children}
    </main>
  );
}

export function MarketingHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-7xl px-6 pt-24 pb-16 text-center">
      <p className="mb-5 font-medium text-sm text-violet-300 uppercase tracking-[0.28em]">
        {eyebrow}
      </p>
      <h1 className="mx-auto max-w-5xl text-balance font-semibold text-5xl tracking-[-0.06em] md:text-7xl">
        {title}
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-white/65 leading-8">
        {description}
      </p>
      {children}
    </section>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-7xl px-6 py-14">
      <div className="mb-8 max-w-3xl">
        <h2 className="font-semibold text-3xl tracking-tight md:text-4xl">
          {title}
        </h2>
        {description ? (
          <p className="mt-3 text-white/60 leading-7">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/20">
      {children}
    </article>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-sm text-white/70">
      {children}
    </span>
  );
}
