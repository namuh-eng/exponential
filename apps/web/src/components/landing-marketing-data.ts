export const DEMO_SESSION_URL = "/api/demo/session";

export const STATUS_PILLS = [
  "postgres",
  "redis",
  "single binary",
  "< 80MB ram idle",
] as const;

export const FEATURES = [
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
] as const;

export const ISSUE_AS_TEXT = `---
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

export const SELF_HOST = `# one network, one volume, three services.
$ git clone <your-fork-url>
$ cd exponential && cp .env.example .env
$ docker compose up -d`;
