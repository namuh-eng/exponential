import {
  LandingCodeBlocks,
  LandingFeatures,
  LandingFooter,
  LandingHero,
} from "@/components/landing-content";
import { LandingTopNav } from "@/components/landing-top-nav";
import { PublicPageFrame } from "@/components/marketing/terminal-primitives";

const REPOSITORY_URL = process.env.NEXT_PUBLIC_EXPONENTIAL_GITHUB_URL?.trim();
const GITHUB_STARS_REVALIDATE_SECONDS = 60 * 60;

type GitHubRepo = {
  readonly owner: string;
  readonly repo: string;
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

    const data: unknown = await response.json();
    if (
      typeof data !== "object" ||
      data === null ||
      !("stargazers_count" in data)
    ) {
      return null;
    }

    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null;
  } catch {
    return null;
  }
}

export async function LandingPage() {
  const githubStars = await getGitHubStars(REPOSITORY_URL);
  const selfHostHref = selfHostingGuideUrl(REPOSITORY_URL);

  return (
    <PublicPageFrame>
      <LandingTopNav repositoryUrl={REPOSITORY_URL} />
      <main className="mx-auto max-w-[1180px] px-6 pb-24 pt-10 sm:px-10">
        <LandingHero
          githubStars={githubStars}
          repositoryUrl={REPOSITORY_URL}
          selfHostHref={selfHostHref}
        />
        <LandingFeatures />
        <LandingCodeBlocks />
      </main>
      <LandingFooter />
    </PublicPageFrame>
  );
}
