# Agent Guide

Project-specific instructions for AI coding agents working in this repo. Read this before making changes. See `CLAUDE.md` and `docs/refactor-plan.md` for the canonical project overview and architecture decisions.

## Project at a Glance
- **What it is**: exponential — a Linear-style issue tracker (issues, projects, cycles, initiatives, triage, inbox).
- **Architecture**: split monorepo with Go headless API, Next.js web UI, generated TypeScript SDK, and TS CLI.
- **Backend**: `apps/api` Go + chi + pgx/sqlc + SQL migrations, deployed as an ECS service behind ALB `/api/*`.
- **Frontend**: `apps/web` Next.js 16 App Router UI-only app that consumes the generated SDK/headless API.
- **Auth**: first-party Go auth. Do **not** reintroduce Kratos, Better Auth, NextAuth, or password auth without an explicit new plan.
- **Tests**: Vitest/unit, Go tests, and Playwright E2E. Required before merge/push when code changes.

## Commands
- `make check` — typecheck + Biome lint/format + Go/API/deploy/OpenAPI guards. Run after every code change.
- `make test` — Go API tests + Vitest unit tests.
- `make test-e2e` — Playwright E2E. Run before manual testing for QA.
- `make all` — check + test.
- `npm run dev` / `pnpm dev` — start the app via workspace scripts.
- `docker compose -f docker-compose.dev.yml up -d` — local Postgres, Redis, API, web, Mailhog.

## Repository Layout
- `apps/api/` — Go API, auth, handlers, OpenAPI strict server stubs, sqlc queries, migrations runner.
- `apps/web/` — Next.js UI. `apps/web/src/app/api/` should remain empty/nonexistent except test-only legacy fixtures under `apps/web/tests/legacy-api`.
- `apps/cli/` — CLI consuming the generated SDK.
- `packages/proto/openapi.yaml` — public API contract.
- `packages/proto/migrations/` — SQL migrations.
- `packages/sdk/` — generated TypeScript SDK plus small hand-written helpers.
- `infra/` — Docker/ECS deployment definitions.
- `scripts/` — validation, OpenAPI, deploy, smoke-test helpers.

## Working Rules
- **TypeScript strict**: no `any`, no `as unknown as` shortcuts. Add real types.
- **Go code**: keep handlers small, use context-aware DB calls, return RFC 7807-style JSON problems for API errors.
- **OpenAPI first**: every Go business endpoint must be represented in `packages/proto/openapi.yaml`; regenerate SDK/stubs when the contract changes.
- **One feature per commit**, with a short, descriptive message.
- **Never weaken or delete tests to make them pass.** Fix the code, not the test.
- **Run `make check && make test` before every commit.**
- **Run `make test-e2e` before declaring UI/runtime flows verified.**
- **Out of scope**: paywalls, billing, subscription management, payment processing. Do not add these.

## UI / Design Conventions
- Preserve the terminal/editorial redesign. Do not revert or delete redesign/theme code from the `308371c` lineage.
- Tailwind utility classes; theme tokens live in `apps/web/tailwind.config.ts` and CSS variables in `apps/web/src/app/globals.css` / `apps/web/src/app/editorial-theme.css`.
- Prefer existing tokens over hard-coded hex values.
- Radix primitives wrap interactive UI. Reuse before introducing a new component library.
- Keyboard-first: every interaction should be reachable by keyboard and/or command palette where appropriate.
- Dark mode is class-based. Style for both modes.

## Verifying Changes
1. `make check` — typecheck + lint + architecture/deploy guards.
2. `make test` — Go + unit tests.
3. `make test-e2e` — E2E with local dev stack.
4. For UI changes, open the affected page in a browser and exercise both the golden path and at least one edge case.
5. For deployment changes, run `scripts/deploy-ecs.sh` with `RUN_PROD_SMOKE=true` and verify ECS/ALB state.

## API Testing
Local API:
```bash
curl -X POST http://localhost:7016/v1/<endpoint> \
  -H "Authorization: Bearer <dev-api-key-or-pat>" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

Through local web proxy:
```bash
curl http://localhost:7015/api/healthz
```

SDK:
```bash
pnpm --filter @exponential/sdk test
```

CLI:
```bash
pnpm --filter @exponential/cli test
```

## Environment
- AWS CLI configured via `~/.aws/credentials`.
- `.env` holds local/deploy credentials; copy from `.env.example` when needed.
- Default local frontend port: **7015**.
- Default local backend port: **7016**.
- Infrastructure provisioning: `bash scripts/preflight.sh`.
- ECS deploy/smoke: `RUN_PROD_SMOKE=true scripts/deploy-ecs.sh`.

## When You Find a Bug
- Fix it in source. Don't paper over it in tests.
- Group fixes for one feature into a single commit after `make check && make test` passes.
- Commit message: `fix: <one-line description>`.
