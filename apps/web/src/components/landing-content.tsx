import {
  DEMO_SESSION_URL,
  FEATURES,
  ISSUE_AS_TEXT,
  SELF_HOST,
  STATUS_PILLS,
} from "@/components/landing-marketing-data";
import { StatusChip } from "@/components/marketing/terminal-primitives";
import Link from "next/link";
import type { ReactNode } from "react";

function formatStarCount(stars: number): string {
  if (stars >= 1000) {
    return `${Number((stars / 1000).toFixed(1))}k`;
  }

  return String(stars);
}

export function LandingHero({
  githubStars,
  repositoryUrl,
  selfHostHref,
}: {
  githubStars: number | null;
  repositoryUrl: string | undefined;
  selfHostHref: string;
}) {
  return (
    <section className="grid gap-10 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
      <div>
        <p className="text-[12px] text-[var(--editorial-ink-3)]">
          $ npm i -g @namuh-eng/expn-cli
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--editorial-ink-3)]">
          <span>{"// source-available · ELv2 · self-hostable"}</span>
          {repositoryUrl && githubStars !== null ? (
            <Link
              href={repositoryUrl}
              aria-label="GitHub stars"
              className="inline-flex min-h-7 items-center border border-[var(--editorial-accent)] bg-[var(--editorial-accent)] px-3 py-1 text-[12px] font-semibold text-[var(--editorial-accent-ink)] transition-colors hover:bg-[var(--editorial-accent-hover)]"
            >
              github stars {formatStarCount(githubStars)}
            </Link>
          ) : null}
        </div>
        <h1 className="mt-8 text-balance font-mono text-[44px] font-medium leading-[1.05] sm:text-[56px] lg:text-[68px]">
          the issue tracker
          <br />
          that <span className="text-[var(--editorial-accent)]">compiles</span>
          <br />
          on your machine.
        </h1>
        <p className="mt-6 max-w-[460px] text-[14px] leading-7 text-[var(--editorial-ink-3)]">
          Exponential is a keyboard-first, terminal-shaped issue tracker.
          Source-available under ELv2: clone it, run it, ship it inside your
          company. The one thing you cannot do is resell it as a hosted service.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href={DEMO_SESSION_URL}
            className="inline-flex min-h-10 items-center border border-[var(--editorial-accent)] bg-[var(--editorial-accent)] px-4 py-2.5 text-[13px] font-medium text-[var(--editorial-accent-ink)] transition-colors hover:bg-[var(--editorial-accent-hover)]"
          >
            view demo
          </Link>
          <Link
            href={selfHostHref}
            className="inline-flex min-h-10 items-center border border-[var(--editorial-line-strong)] px-4 py-2.5 text-[13px] font-medium text-[var(--editorial-ink-1)] transition-colors hover:bg-[var(--editorial-hover)]"
          >
            open self-host guide
          </Link>
          <Link
            href={selfHostHref}
            className="border border-transparent px-2 py-1 text-[13px] text-[var(--editorial-ink-2)] transition-colors hover:border-[var(--editorial-line)] hover:bg-[var(--editorial-hover)]"
          >
            view docker compose setup →
          </Link>
        </div>
        <ul className="mt-10 flex flex-wrap gap-2 text-[12px] text-[var(--editorial-ink-3)]">
          {STATUS_PILLS.map((pill) => (
            <li key={pill}>
              <StatusChip>{pill}</StatusChip>
            </li>
          ))}
        </ul>
      </div>

      <TerminalWindow path="~/nimbus/core · exponential">
        <div className="space-y-1 text-[12px] leading-relaxed">
          <Line c="dim">$ exponential issue ls --cycle 14 --me</Line>
          <Line c="dim">
            ────────────────────────────────────────────────────────────
          </Line>
          <Line>
            <span className="text-[var(--editorial-ink-4)]">EXP-241</span>{" "}
            <span className="text-[var(--editorial-warn)]">◐ !!</span> Race in
            scheduler when cycle ends mid-rollout
          </Line>
          <Line>
            <span className="text-[var(--editorial-ink-4)]">EXP-240</span>{" "}
            <span className="text-[var(--editorial-ink-3)]">○ !!</span>{" "}
            Self-host: docker-compose drops postgres volume
          </Line>
          <Line>
            <span className="text-[var(--editorial-ink-4)]">EXP-238</span>{" "}
            <span className="text-[var(--editorial-ink-3)]">○ !.</span> Roadmap:
            cycles past 12 weeks render off-canvas
          </Line>
          <Line>
            <span className="text-[var(--editorial-ink-4)]">EXP-233</span>{" "}
            <span className="text-[var(--editorial-warn)]">◐ !!</span> Webhooks:
            signing key rotation deletes outbound
          </Line>
          <Line c="dim">
            ────────────────────────────────────────────────────────────
          </Line>
          <Line>4 issues · cycle 14 · assignee:you · sorted age↓</Line>
          <Line c="dim">$ exponential cycle :current</Line>
          <Line>
            cycle 14 · May 05 - May 18 · 18/27 done ·{" "}
            <span className="text-[var(--editorial-warn)]">
              2 spillover predicted
            </span>
          </Line>
          <Line c="dim">$ exponential _</Line>
        </div>
      </TerminalWindow>
    </section>
  );
}

export function LandingFeatures() {
  return (
    <section className="mt-28 border-t border-[var(--editorial-line)] pt-14">
      <div className="grid gap-10 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <article key={feature.n}>
            <p className="text-[11px] uppercase text-[var(--editorial-ink-4)]">
              {`// ${feature.n}`}
            </p>
            <h3 className="mt-3 font-mono text-[20px] font-medium">
              {feature.title}
            </h3>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--editorial-ink-3)]">
              {feature.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function LandingCodeBlocks() {
  return (
    <section className="mt-24 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <TerminalWindow path="# issue as text" tone="dark">
        <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed">
          {ISSUE_AS_TEXT}
        </pre>
      </TerminalWindow>
      <TerminalWindow path="# self-host in 3 lines" tone="dark">
        <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed">
          {SELF_HOST}
        </pre>
        <p className="mt-6 text-[11px] text-[var(--editorial-ink-4)]">
          backed by postgres · redis · S3-compatible blob
        </p>
      </TerminalWindow>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--editorial-line)]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-2 px-6 py-6 text-[11px] text-[var(--editorial-ink-3)] sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <span>© 2026 exponential · ELv2 (source-available)</span>
        <span>runs on your hardware</span>
      </div>
    </footer>
  );
}

function TerminalWindow({
  path,
  tone = "light",
  children,
}: {
  path: string;
  tone?: "light" | "dark";
  children: ReactNode;
}) {
  const isDark = tone === "dark";
  return (
    <div
      className={
        isDark
          ? "min-w-0 overflow-hidden border border-[var(--editorial-line-strong)] bg-[var(--editorial-surface-2)] text-[var(--editorial-ink-1)]"
          : "tty-panel min-w-0 overflow-hidden"
      }
    >
      <div className="tty-status-bar justify-between border-b px-3 py-2">
        <span>{path}</span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 bg-[var(--editorial-ink-5)]" />
          <span className="h-2 w-2 bg-[var(--editorial-ink-5)]" />
          <span className="h-2 w-2 bg-[var(--editorial-ink-5)]" />
        </span>
      </div>
      <div className="px-4 py-4 sm:px-5 sm:py-5">{children}</div>
    </div>
  );
}

function Line({
  c = "default",
  children,
}: {
  c?: "default" | "dim";
  children: ReactNode;
}) {
  return (
    <div
      className={
        c === "dim"
          ? "break-words text-[var(--editorial-ink-4)]"
          : "break-words text-[var(--editorial-ink-2)]"
      }
    >
      {children}
    </div>
  );
}
