# Pre-configured Setup — DO NOT recreate or reinstall

Everything listed here is already installed and configured. Do NOT reinstall, reconfigure, or overwrite these.

## Tooling
- **Next.js 16** — `next.config.js` (standalone output for Docker, Turbopack)
- **TypeScript** — `tsconfig.json` (strict mode, `@/` path aliases)
- **Tailwind CSS** — `tailwind.config.ts` + `postcss.config.js` (dark mode, src paths)
- **Biome** — `biome.json` (lint + format, replaces ESLint/Prettier)
- **Vitest** — `vitest.config.ts` (jsdom, path aliases, `tests/*.test.ts`)
- **Playwright** — `playwright.config.ts` + Chromium installed (`tests/e2e/*.spec.ts`)
- **Drizzle ORM** — `drizzle.config.ts` + `src/lib/db/index.ts` + `src/lib/db/schema.ts`
- **Docker** — `Dockerfile` (multi-stage, standalone) + `.dockerignore`

## Commands (use these, don't create new ones)
- `make check` — typecheck + Biome lint/format
- `make test` — unit tests (Vitest)
- `make test-e2e` — E2E tests (Playwright, needs dev server)
- `make all` — check + test
- `make fix` — auto-fix lint/format issues
- `make db-push` — push Drizzle schema to Postgres
- `npm run dev` — dev server on port **7015**
- `npm run build` — production build

## AWS Infrastructure (provision with scripts/preflight.sh)
Run `bash scripts/preflight.sh` before starting the loop. It creates:
- **RDS Postgres** — database instance, connection string added to `.env`
- **ElastiCache Redis** — real-time sync, caching, pub/sub for live updates
- **S3** — file attachments, avatars, storage bucket with CORS
- **ECR** — Docker image repository
- **ECS Fargate + ALB** — container hosting with load balancer
- **SES** — email identity verification (magic links, notifications)

## Cloudflare DNS (optional)
If you want auto-configure for domain verification, add to `.env`:
- `CLOUDFLARE_API_TOKEN` — API token with Edit zone DNS permission
- `CLOUDFLARE_ZONE_ID` — your domain's zone ID

## Project Structure (already scaffolded)
```
src/app/           — Next.js App Router (layout.tsx, page.tsx, globals.css)
src/app/api/       — API routes (created by build agent)
src/components/    — React components (created by build agent)
src/lib/           — Utilities and clients
src/lib/db/        — Drizzle ORM (index.ts + schema.ts ready)
src/types/         — TypeScript types
tests/             — Unit tests (Vitest)
tests/e2e/         — E2E tests (Playwright)
packages/sdk/      — SDK package (created by build agent if target has SDK)
ralph/screenshots/inspect/ — Original product screenshots
ralph/screenshots/build/   — Build verification screenshots
ralph/screenshots/qa/      — QA evidence screenshots
scripts/           — Infrastructure and deploy scripts
```

## Port
Dev server runs on **7015**. Do not change this.
