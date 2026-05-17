import Link from "next/link";
import type { ReactNode } from "react";

const navLinks = [
  { label: "Homepage", href: "/homepage" },
  { label: "Product", href: "/homepage#product" },
  { label: "Resources", href: "/changelog" },
  { label: "Customers", href: "/customers" },
  { label: "Pricing", href: "/pricing" },
  { label: "Now", href: "/now" },
  { label: "Contact", href: "/homepage#contact" },
];

export function MarketingShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#08090a] text-[#f7f4ee]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 text-sm text-[#b9b1a5]">
        <Link href="/homepage" className="font-semibold text-[#f7f4ee]">
          Linear
        </Link>
        <nav aria-label="Public" className="hidden items-center gap-5 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href + link.label}
              href={link.href}
              className="hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="hover:text-white">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-[#f7f4ee] px-4 py-2 font-medium text-[#08090a] hover:bg-white"
          >
            Sign up
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 pb-20 pt-16">
        <p className="mb-5 text-sm font-medium uppercase tracking-[0.32em] text-[#8a7cff]">
          {eyebrow}
        </p>
        <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.06em] text-white md:text-7xl">
          {title}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-[#c9c0b6]">
          {description}
        </p>
      </section>
      {children}
    </main>
  );
}

export function MarketingSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-7xl px-6 py-12">
      <h2 className="mb-6 text-2xl font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

export function MarketingCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/20">
      {children}
    </div>
  );
}
