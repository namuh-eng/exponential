import { ExponentialMark } from "@/components/exponential-mark";
import {
  CommandLink,
  PublicPageFrame,
  StatusChip,
} from "@/components/marketing/terminal-primitives";
import Link from "next/link";

const REPOSITORY_URL = process.env.NEXT_PUBLIC_EXPONENTIAL_GITHUB_URL?.trim();
const GITHUB_STARS_REVALIDATE_SECONDS = 60 * 60;

const NAV_LINKS = [
  { href: "/docs", label: "docs" },
  { href: "/self-host", label: "self-host" },
  { href: "/changelog", label: "changelog" },
  ...(REPOSITORY_URL ? [{ href: REPOSITORY_URL, label: "github" }] : []),
];

const STATUS_PILLS = ["postgres", "redis", "single binary", "< 80MB ram idle"];

const FEATURES = [
  {
    n: "01",
    title: "keyboard-first, mouse-optional",
    body: "Every action has a binding. Vim-style modal nav: g for go, c for create, : for command. The mouse is for skimming, the keyboard is for working.",
  },
  {
    n: "02",
    title: "self-hosted by default",
    body: "One docker-compose, one binary, one postgres. No paid tier hiding self-host behind a sales call. The hosted version runs on the same code.",
  },
  {
    n: "03",
    title: "text in, text out",
    body: "Issues serialize as Markdown with YAML frontmatter. Diff them in git. Pipe them through grep. Apply them with a CLI. It is text. It stays text.",
  },
];

const ISSUE_AS_TEXT = `---
id: ENG-142
title: rate limit cache stampede on cold start
status: in-progress
assignee: priya
labels: [bug, infra, p1]
---

## context

cold deploy of api-gateway → all instances refill
the rate-limit cache from scratch → upstream auth
service sees 14k qps for ~8s, then settles.

## acceptance

- [ ] add SWR layer in front of Redis
- [ ] add p99 dashboard for /authorize
- [ ] write regression for cold-start fanout`;

const SELF_HOST = `# one network, one volume, three services.
$ git clone <your-fork-url>
$ cd exponential && cp .env.example .env
$ docker compose up -d`;

type GitHubRepo = {
  owner: string;
  repo: string;
};

type GitHubRepoResponse = {
  stargazers_count?: unknown;
};

function parseGitHubRepo(repositoryUrl: string | undefined): GitHubRepo | null {
  if (!repositoryUrl) {
    return null;
  }

  try {
    const url = new URL(repositoryUrl);
    if (url.hostname !== "github.com") {
      return null;
    }

    const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
    const repo = rawRepo?.replace(/\.git$/, "");

    if (!owner || !repo) {
      return null;
    }

    return { owner, repo };
  } catch {
    return null;
  }
}

function githubRepoBaseUrl(repositoryUrl: string | undefined): string | null {
  const repo = parseGitHubRepo(repositoryUrl);
  return repo ? `https://github.com/${repo.owner}/${repo.repo}` : null;
}

function selfHostingGuideUrl(repositoryUrl: string | undefined): string {
  const repoUrl = githubRepoBaseUrl(repositoryUrl);
  return repoUrl ? `${repoUrl}/blob/main/docs/self-hosting.md` : "/self-host";
}

async function getGitHubStars(
  repositoryUrl: string | undefined,
): Promise<number | null> {
  const repo = parseGitHubRepo(repositoryUrl);
  if (!repo) {
    return null;
  }

  const requestInit: RequestInit & { next?: { revalidate: number } } = {
    headers: { Accept: "application/vnd.github+json" },
    next: { revalidate: GITHUB_STARS_REVALIDATE_SECONDS },
  };

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}`,
      requestInit,
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as GitHubRepoResponse;
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null;
  } catch {
    return null;
  }
}

function formatStarCount(stars: number): string {
  if (stars >= 1000) {
    return `${Number((stars / 1000).toFixed(1))}k`;
  }

  return String(stars);
}

export async function LandingPage() {
  const githubStars = await getGitHubStars(REPOSITORY_URL);
  const selfHostHref = selfHostingGuideUrl(REPOSITORY_URL);

  return (
    <PublicPageFrame>
      <TopNav />
      <main className="mx-auto max-w-[1180px] px-6 pb-24 pt-10 sm:px-10">
        <Hero githubStars={githubStars} selfHostHref={selfHostHref} />
        <Features />
        <CodeBlocks />
      </main>
      <Footer />
    </PublicPageFrame>
  );
}

function TopNav() {
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
        </nav>
        <div className="hidden items-center gap-3 text-[12px] text-[var(--editorial-ink-3)] md:flex">
          <span aria-label="Source availability">source available</span>
          <span className="border border-[var(--editorial-line-strong)] px-2.5 py-1 text-[var(--editorial-ink-1)]">
            $ npm i -g @namuh-eng/expn-cli
          </span>
          <CommandLink href="/login" variant="ghost" className="min-h-8 px-3">
            log in
          </CommandLink>
        </div>
      </div>
    </header>
  );
}

function Hero({
  githubStars,
  selfHostHref,
}: {
  githubStars: number | null;
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
          {REPOSITORY_URL && githubStars !== null ? (
            <Link
              href={REPOSITORY_URL}
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
            href={selfHostHref}
            className="inline-flex min-h-10 items-center border border-[var(--editorial-accent)] bg-[var(--editorial-accent)] px-4 py-2.5 text-[13px] font-medium text-[var(--editorial-accent-ink)] transition-colors hover:bg-[var(--editorial-accent-hover)]"
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

function Features() {
  return (
    <section className="mt-28 border-t border-[var(--editorial-line)] pt-14">
      <div className="grid gap-10 md:grid-cols-3">
        {FEATURES.map((f) => (
          <article key={f.n}>
            <p className="text-[11px] uppercase text-[var(--editorial-ink-4)]">
              {`// ${f.n}`}
            </p>
            <h3 className="mt-3 font-mono text-[20px] font-medium">
              {f.title}
            </h3>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--editorial-ink-3)]">
              {f.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function CodeBlocks() {
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

function TerminalWindow({
  path,
  tone = "light",
  children,
}: {
  path: string;
  tone?: "light" | "dark";
  children: React.ReactNode;
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
  children: React.ReactNode;
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

function Footer() {
  return (
    <footer className="border-t border-[var(--editorial-line)]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-2 px-6 py-6 text-[11px] text-[var(--editorial-ink-3)] sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <span>© 2026 exponential · ELv2 (source-available)</span>
        <span>runs on your hardware</span>
      </div>
    </footer>
  );
}
