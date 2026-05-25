# exponential: Linear Clone

## What This Is
A production-grade clone of [linear.app](https://linear.app) — a keyboard-first issue tracking and project management tool for software teams.

## Tech Stack
- **Framework**: Next.js 16 App Router
- **Language**: TypeScript strict mode, no `any` types
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI
- **Database**: Drizzle ORM + Postgres (AWS RDS)
- **Cache/Realtime**: Redis (AWS ElastiCache) — real-time sync, pub/sub
- **Storage**: AWS S3 — file attachments, avatars
- **Email**: AWS SES — magic links, notifications
- **Auth**: Better Auth (Google OAuth, magic links)
- **Deployment**: AWS ECS Fargate + ALB
- **Unit Tests**: Vitest (pre-installed)
- **E2E Tests**: Playwright (pre-installed)
- **Linting**: Biome (pre-installed)

## Commands
- `make check` — typecheck + lint/format (Biome)
- `make test` — run unit tests (Vitest)
- `make test-e2e` — run E2E tests (Playwright, requires dev server)
- `make all` — check + test
- `npm run dev` — start dev server (default port 3000)
- `npm run build` — production build
- `npm run db:push` — push Drizzle schema to Postgres

## Quality Standards
- TypeScript strict mode, no `any` types
- Every feature must have at least one unit test AND one Playwright E2E test
- Run `make check && make test` before every commit
- Small, focused commits — one feature per commit

## Architecture
- `src/app/` — Next.js App Router pages and API routes
- `src/components/` — React components
- `src/lib/` — utilities, helpers, API clients
- `src/lib/db/` — Drizzle ORM schema and client
- `src/types/` — TypeScript types
- `tests/` — unit tests (Vitest)
- `tests/e2e/` — E2E tests (Playwright)
- `packages/sdk/` — TypeScript SDK package
- `scripts/` — infrastructure and deployment scripts

## Pre-configured (DO NOT reinstall or recreate)
- **Playwright** — `playwright.config.ts`, `tests/e2e/`, `npm run test:e2e`
- **Biome** — `biome.json`, fast lint + format
- **Makefile** — `make check`, `make test`, `make test-e2e`, `make all`

## Environment
- **AWS CLI** — configure via `aws configure`. `aws` commands and `@aws-sdk/*` packages work out of the box.
- **`.env`** — copy from `.env.example` and fill in your values
- **Infrastructure** — run `bash scripts/preflight.sh` to provision RDS, ElastiCache, S3, ECR, ECS, ALB, SES

## Authentication
- Use **Better Auth** for all authentication — already installed
- Auth methods: Google OAuth, email magic links (via SES), workspace invitations
- Protect routes via Next.js middleware (`src/middleware.ts`)
- Store sessions in Postgres via Better Auth's built-in Drizzle adapter
- Auth is **P1 priority** — build it before core features

## Out of Scope — DO NOT build
- Paywalls, billing, subscription management
- Payment processing
