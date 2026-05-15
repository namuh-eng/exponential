# exponential

[![GitHub stars](https://img.shields.io/github/stars/namuh-eng/exponential?style=flat-square)](https://github.com/namuh-eng/exponential)
[![License: ELv2](https://img.shields.io/badge/License-Elastic%202.0-blue.svg?style=flat-square)](LICENSE)
[![Docker pulls](https://img.shields.io/docker/pulls/namuh-eng/exponential?style=flat-square)](https://hub.docker.com/r/namuh-eng/exponential)

**Open source Linear alternative — keyboard-first issue tracking for software teams.**

A fully functional clone of [Linear](https://linear.app) built with Next.js 16, TypeScript, and modern infrastructure. Fast, self-hostable, and designed for teams that live in their terminal.

---

## About

exponential is a production-grade issue tracking and project management tool built to match Linear's speed and keyboard-first UX. Whether you're a startup building in public or an enterprise needing self-hosted infrastructure, exponential is a fully open source alternative that you can deploy, customize, and extend.

Built by [ralph-to-ralph](https://github.com/namuh-eng/ralph-to-ralph), an autonomous product cloning system, exponential represents 41 features across issues, projects, cycles, initiatives, and real-time notifications — all tested and deployed from day one.

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

### Option 1: Local Development

```bash
# Clone the repository
git clone https://github.com/namuh-eng/exponential.git
cd exponential

# Install dependencies
npm install

# Start infrastructure services (PostgreSQL + Redis)
make dev-services

# Configure environment
cp .env.example .env
# Edit .env with your AWS credentials and auth settings

# Run database migrations
npm run db:push

# Start the dev server (runs on http://localhost:3000)
npm run dev
```

### Option 2: Docker Compose (Coming Soon)

```bash
git clone https://github.com/namuh-eng/exponential.git
cd exponential

docker compose up
```

The app will be available at `http://localhost:3000`.

### Option 3: Cloud Deployment (Coming Soon)

One-click deployment to Vercel or Railway coming soon.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript |
| **Styling** | Tailwind CSS, Radix UI |
| **Database** | PostgreSQL (AWS RDS), Drizzle ORM |
| **Cache & Realtime** | Redis (AWS ElastiCache), ioredis |
| **Authentication** | Better Auth, Google OAuth, Magic Links |
| **Storage** | AWS S3 (files, avatars) |
| **Email** | AWS SES (magic links, notifications) |
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
- **100% tested** — every feature has unit tests (Vitest) and E2E tests (Playwright)
- **Consistent formatting** — Biome handles linting and formatting
- **Small commits** — one feature per commit with clear messages

### Project Structure

```
exponential/
├── src/
│   ├── app/              # Next.js App Router pages and API routes
│   ├── components/       # Reusable React components
│   ├── lib/              # Utilities, helpers, API clients
│   │   └── db/           # Drizzle ORM schema
│   └── types/            # TypeScript types
├── tests/                # Vitest unit tests
│   └── e2e/              # Playwright E2E tests
├── packages/sdk/         # TypeScript SDK
└── scripts/              # Infrastructure and deployment
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
# Database
DATABASE_URL=postgresql://user:password@localhost/exponential

# Redis
REDIS_URL=redis://localhost:6379

# AWS (optional, required for production)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# S3 (for file uploads)
AWS_S3_BUCKET=exponential-uploads

# SES (for email)
AWS_SES_SENDER_EMAIL=noreply@exponential.com

# Authentication
AUTH_GOOGLE_ID=your-google-oauth-id
AUTH_GOOGLE_SECRET=your-google-oauth-secret
BETTER_AUTH_SECRET=your-random-secret
```

### Infrastructure Provisioning (Production)

To provision AWS infrastructure (RDS, ElastiCache, S3, ECR, SES):

```bash
bash scripts/preflight.sh
```

This script will:
- Create RDS PostgreSQL instance
- Create ElastiCache Redis cluster
- Create S3 bucket for uploads
- Configure SES for email delivery
- Create ECR registry for Docker images

---

## Built by AI

exponential was built autonomously by **[ralph-to-ralph](https://github.com/namuh-eng/ralph-to-ralph)**, a multi-agent system that clones SaaS products end-to-end.

The system:
1. **Inspects** the target product (Linear) using Claude + Ever CLI
2. **Builds** a working clone with TDD — 41 features, 24,000+ lines of code
3. **Tests** every feature with Vitest + Playwright
4. **Deploys** to AWS with real infrastructure

The entire process runs fully autonomous with zero human intervention. This README and documentation are human-written to ensure clarity and accuracy.

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
- **Documentation** — [Full docs coming soon]

---

<div align="center">

Built with by [Jaeyun Ha](https://github.com/jaeyunha) at Ralphthon Seoul 2026

If you find this project helpful, consider giving it a star ⭐

</div>
