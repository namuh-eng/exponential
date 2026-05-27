# exponential

[![GitHub stars](https://img.shields.io/github/stars/namuh-eng/exponential?style=flat-square)](https://github.com/namuh-eng/exponential)
[![License: ELv2](https://img.shields.io/badge/License-Elastic%202.0-blue.svg?style=flat-square)](LICENSE)

**Open source Linear alternative — keyboard-first issue tracking for software teams.**

A fully functional clone of [Linear](https://linear.app) built with Next.js 16, TypeScript, and modern infrastructure. Fast, self-hostable, and designed for teams that live in their terminal.

---

## About

exponential is a production-grade issue tracking and project management tool built to match Linear's speed and keyboard-first UX. Whether you're a startup building in public or an enterprise needing self-hosted infrastructure, exponential is a fully open source alternative that you can deploy, customize, and extend.

exponential covers core issue, project, cycle, initiative, and notification workflows with automated validation across the monorepo.

---

## Features

Core capabilities:

- **Issues** — Create, assign, prioritize, estimate, label, and organize with workflow states (Backlog, In Progress, Done, Canceled)
- **Projects** — Time-bound deliverables with milestones, progress tracking, and status updates
- **Cycles** — Automated sprints with burndown charts and auto-rollover
- **Initiatives** — Strategic roadmap grouping multiple projects
- **Custom Views** — Filter-based board, list, and timeline layouts
- **Triage Queue** — Intake system for incoming issues with bulk actions
- **Inbox & Notifications** — Real-time updates for assignments, mentions, and status changes
- **Command Palette** — Cmd+K for fast navigation and issue creation
- **Keyboard Shortcuts** — Full keyboard support throughout the app
- **Authentication** — Google OAuth and magic link login
- **Real-time Sync** — Live updates via Redis
- **File Attachments** — Upload and store files on AWS S3

---

## Quick Start

### Option 1: Self-host with Docker Compose

```bash
git clone https://github.com/namuh-eng/exponential.git
cd exponential
cp .env.example .env

# Replace the sample secrets in .env.
openssl rand -hex 32 # copy into EXPONENTIAL_SESSION_SECRET
openssl rand -hex 32 # copy into EXPONENTIAL_INVITE_TOKEN_SECRET
$EDITOR .env

docker compose up --build
```

The app will be available at `http://localhost:7015`. See
[docs/self-hosting.md](docs/self-hosting.md) for reverse proxy, backup, upgrade,
optional S3/SES, and AWS ECS deployment notes.

### Option 2: Local Development

```bash
# Clone the repository
git clone https://github.com/namuh-eng/exponential.git
cd exponential

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env

# Start Postgres, Redis, the Go API, and the Next.js dev server
docker compose -f docker-compose.dev.yml up --build
```

The development stack runs on `http://localhost:7015` and includes Mailhog.

### Option 3: AWS ECS Deployment

```bash
cp .env.example .env
bash scripts/prepare-ecs-deploy-env.sh
DB_PASSWORD=<generated-or-existing-password> bash scripts/preflight.sh
bash scripts/prepare-ecs-deploy-env.sh
RUN_PROD_SMOKE=true scripts/deploy-ecs.sh
```

The ECS path provisions and deploys split web/API services behind an ALB.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript |
| **Styling** | Tailwind CSS, Radix UI |
| **Database** | PostgreSQL, pgx/sqlc, Drizzle schema tasks |
| **Cache & Realtime** | Redis (AWS ElastiCache), ioredis |
| **Authentication** | First-party Go auth, Google OAuth, magic links |
| **Storage** | Optional AWS S3-compatible attachment storage |
| **Email** | Optional AWS SES email delivery |
| **Testing** | Vitest (unit), Playwright (E2E) |
| **Linting** | Biome |
| **Deployment** | Docker, AWS ECS Fargate |

---

## Development

### Commands

```bash
# Type check and lint
make check

# Run unit tests
make test

# Run E2E tests (requires dev server running)
make test-e2e

# Run all checks
make all

# Start dev server
npm run dev

# Build for production
npm run build

# Push database schema changes
npm run db:push
```

### Quality Standards

- **TypeScript strict mode** — no `any` types
- **Tested changes** — Go tests, Vitest/unit tests, and Playwright E2E cover critical flows
- **Consistent formatting** — Biome handles linting and formatting
- **Small commits** — one feature per commit with clear messages

### Project Structure

```
exponential/
├── apps/api/             # Go headless API and migration binary
├── apps/web/             # Next.js UI-only app
├── packages/proto/       # OpenAPI contract and SQL migrations
├── packages/sdk/         # Generated TypeScript SDK
├── infra/                # Dockerfiles and ECS task definitions
├── scripts/              # Validation and deployment scripts
└── tests/                # Cross-app tests
```

---

## Environment Setup

### Prerequisites

- **Node.js 20+** — [install](https://nodejs.org/)
- **PostgreSQL 15+** — local or AWS RDS
- **Redis 7+** — local or AWS ElastiCache
- **AWS Account** (optional) — for S3, SES, RDS, ElastiCache

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Database and Redis
DATABASE_URL=postgresql://postgres:password@localhost:15532/exponential?sslmode=disable
REDIS_URL=redis://localhost:16379

# Public URLs and first-party auth
EXPONENTIAL_SESSION_SECRET=<openssl-rand-hex-32>
EXPONENTIAL_INVITE_TOKEN_SECRET=<openssl-rand-hex-32>
EXPONENTIAL_APP_URL=http://localhost:7015
NEXT_PUBLIC_APP_URL=http://localhost:7015

# Optional OAuth / storage / email
AUTH_GOOGLE_ID=your-google-oauth-id
AUTH_GOOGLE_SECRET=your-google-oauth-secret
AWS_REGION=us-east-1
S3_BUCKET=exponential-uploads
SENDER_EMAIL=noreply@example.com
```

### Self-hosting and infrastructure

For a single-host install, use `docker compose up --build`; it builds the split
Go API and Next.js web images and runs both schema/migration jobs. For AWS ECS,
use `scripts/prepare-ecs-deploy-env.sh`, `scripts/preflight.sh`, and
`scripts/deploy-ecs.sh`. Full details: [docs/self-hosting.md](docs/self-hosting.md).

---

## Contributing

We welcome contributions! Whether it's bug fixes, new features, or improvements to documentation, all are appreciated.

**Start here:** [CONTRIBUTING.md](CONTRIBUTING.md)

---

## License

[Elastic License 2.0](LICENSE) — Use, modify, and self-host freely. You may not offer the software as a hosted service to third parties. See [LICENSE](LICENSE) for full terms.

---

## Support

- **Issues** — Report bugs or request features on [GitHub Issues](https://github.com/namuh-eng/exponential/issues)
- **Discussions** — Ask questions on [GitHub Discussions](https://github.com/namuh-eng/exponential/discussions)
- **Documentation** — Start with [self-hosting](docs/self-hosting.md) and [contributing](CONTRIBUTING.md)

---

<div align="center">

Built with by [Jaeyun Ha](https://github.com/jaeyunha) at Ralphthon Seoul 2026

If you find this project helpful, consider giving it a star ⭐

</div>
