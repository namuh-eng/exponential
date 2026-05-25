# Agent Guide

Project-specific instructions for AI coding agents working in this repo. Read this before making changes. See `CLAUDE.md` for the canonical project overview (tech stack, commands, quality standards).

## Project at a Glance
- **What it is**: exponential — a Linear-style issue tracker (issues, projects, cycles, initiatives, triage, inbox).
- **Stack**: Next.js 16 App Router, TypeScript strict (no `any`), Tailwind, Radix UI, Drizzle + Postgres, Redis, Better Auth.
- **Tests**: Vitest (unit) and Playwright (E2E). Both are required for every feature.

## Commands
- `make check` — typecheck + Biome lint/format. Run after every code change.
- `make test` — unit tests (Vitest).
- `make test-e2e` — Playwright E2E (requires dev server on port 3000).
- `make all` — check + test.
- `npm run dev` — dev server (default port 3000).
- `npm run db:push` — push Drizzle schema to Postgres.

## Repository Layout
- `src/app/` — Next.js App Router pages and API routes (`/api/*`).
  - `src/app/(app)/` — authenticated app shell and routes.
  - `src/app/(auth)/` — login / signup.
  - `src/app/globals.css`, `src/app/editorial-theme.css` — global styles.
- `src/components/` — React components (one file per component, kebab-case).
- `src/components/icons/` — shared icon components (priority, status, etc.).
- `src/lib/` — utilities and clients (db, ses, s3, redis, auth).
- `src/lib/db/` — Drizzle ORM schema and client.
- `src/hooks/` — React hooks.
- `src/types/` — shared TypeScript types.
- `tests/` — Vitest unit tests.
- `tests/e2e/` — Playwright E2E tests.
- `packages/sdk/` — TypeScript SDK package.
- `scripts/` — infrastructure / deployment helpers (`preflight.sh`, etc.).

## Working Rules
- **TypeScript strict**: no `any`, no `as unknown as` shortcuts. Add real types.
- **One feature per commit**, with a short, descriptive message.
- **Tests required**: at least one Vitest unit test AND one Playwright E2E test for every new user-visible feature.
- **Never weaken or delete tests to make them pass.** Fix the code, not the test.
- **Run `make check && make test`** before every commit.
- **Don't reinstall pre-configured tooling**: Playwright (`playwright.config.ts`, `tests/e2e/`), Biome (`biome.json`), and the Makefile are set up already.
- **Auth is via Better Auth** — don't bring in NextAuth or roll your own.
- **Out of scope**: paywalls, billing, subscription management, payment processing. Do not add these.

## UI / Design Conventions
- Tailwind utility classes; theme tokens live in `tailwind.config.ts` (`font-sans`, `font-display`, `font-mono` map to the editorial CSS variables).
- Global theme tokens (colors, spacing, surfaces) are defined in `src/app/globals.css` and `src/app/editorial-theme.css`. Prefer existing tokens over hard-coded hex values.
- Radix primitives wrap interactive UI (menus, dialogs, popovers). Reuse before introducing a new component library.
- Keyboard-first: every interaction should have a shortcut or be reachable from the command palette (`src/components/command-palette.tsx`). New surfaces should respect this.
- Dark mode is class-based (`darkMode: "class"` in `tailwind.config.ts`). Style for both modes.

## Verifying Changes
1. `make check` — typecheck + lint.
2. `make test` — unit tests.
3. `make test-e2e` — E2E (start `npm run dev` first if not running).
4. For UI changes, open the affected page in a browser and exercise both the golden path and at least one edge case.

## API Testing
For API routes:
```bash
curl -X POST http://localhost:3000/api/<endpoint> \
  -H "Authorization: Bearer <dev-api-key>" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

For the SDK:
```bash
cd packages/sdk && npm test
```

## Environment
- AWS CLI configured via `~/.aws/credentials` (works out of the box for `aws` and `@aws-sdk/*`).
- `.env` holds local credentials — copy from `.env.example`.
- Infrastructure provisioning: `bash scripts/preflight.sh` (RDS, ElastiCache, S3, ECR, ECS, ALB, SES).

## When You Find a Bug
- Fix it in source. Don't paper over it in tests.
- Group fixes for one feature into a single commit after `make check && make test` passes.
- Commit message: `fix: <one-line description>`.
