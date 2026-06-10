# exponential: Agent Context

## What This Is

exponential is a source-available, self-hostable Linear-style issue tracker for
issues, projects, cycles, initiatives, triage, inbox, and workspace
administration.

The current repo is a split monorepo:

- `apps/api` - Go headless API, auth, OpenAPI strict stubs, pgx/sqlc, SQL
  migrations, RED metrics, and deployment health surfaces.
- `apps/web` - Next.js 16 App Router UI-only app that consumes the Go API
  through the generated SDK and same-origin `/api/*` rewrites.
- `apps/cli` - TypeScript CLI over the generated SDK.
- `apps/mcp` and `packages/mcp-server` - local read-only stdio MCP runtime.
- `packages/proto` - OpenAPI contract and SQL migrations.
- `packages/sdk` - generated TypeScript SDK plus small hand-written helpers.
- `infra` and `scripts` - Docker, ECS, validation, smoke, and generation
  helpers.

For the current operator/developer map, start with `README.md`,
`CONTRIBUTING.md`, `docs/README.md`, and `AGENTS.md`. `docs/refactor-plan.md`
is historical context for the Go split, not a current-state source of truth.

## Tech Stack

- **Web**: Next.js 16 App Router, React 19, TypeScript strict mode, Tailwind,
  Radix UI.
- **API**: Go, chi, pgx, sqlc, OpenAPI strict server stubs.
- **Data**: PostgreSQL 15+, SQL migrations, Redis 7+.
- **Contract**: `packages/proto/openapi.yaml`, generated Go stubs, generated
  TypeScript SDK.
- **Auth**: first-party Go auth with Google OAuth, magic links, session
  cookies, workspace invitations, and PATs for headless clients.
- **Deployment**: Docker Compose for one host; AWS ECS Fargate + ALB for
  managed infra.
- **Validation**: Biome, TypeScript, Go tests, Vitest, Playwright, OpenAPI,
  sqlc, Docker/ECS/deploy guards.

## Commands

- `make check` - typecheck, Biome lint/format, Go API build, Docker/ECS/deploy
  guards, OpenAPI coverage, generated-stub checks, sqlc checks, and web API/SDK
  architecture checks.
- `make test` - Go API tests plus Vitest unit/component tests.
- `make test-e2e` - Playwright E2E; requires the local dev stack/server.
- `make all` - `make check` plus `make test`.
- `pnpm dev` - starts the web app via `@exponential/web` on port `7015` after
  database preflight.
- `docker compose -f docker-compose.dev.yml up --build` - starts local
  Postgres, Redis, API, web, and Mailhog.
- `make dev-services` - starts local Postgres/Redis services for host-run dev.
- `make build` - production build through Turborepo.

Default local ports:

- Web: `http://localhost:7015`
- API: `http://localhost:7016`

## Quality Standards

- TypeScript strict mode: no `any`, no `as unknown as` shortcuts.
- Go handlers should stay small, use context-aware DB calls, and return RFC
  7807-style JSON problems for API errors.
- OpenAPI first: public Go business endpoints must be represented in
  `packages/proto/openapi.yaml`; regenerate SDK/stubs when the contract changes.
- Keep `apps/web` UI-only for runtime business endpoints. Do not add new
  business API routes under `apps/web/src/app/api`.
- Use the generated SDK for migrated web runtime slices instead of hard-coded
  endpoint fetches.
- Never weaken or delete tests to make them pass. Fix the source or the test
  contract honestly.
- Run `make check && make test` before committing code changes. Run
  `make test-e2e` before declaring browser-facing flows verified.

## Architecture Rules

### API and SDK

- API clients use `/v1/*`.
- Browser traffic goes through same-origin `/api/*` rewrites to the Go API.
- `packages/proto/openapi.yaml` is the public API contract.
- `packages/sdk` is generated from the OpenAPI contract and is consumed by the
  CLI, MCP server, and migrated web clients.
- Inbound provider callbacks, such as Stripe webhooks, may be mounted under API
  routes without being part of the public SDK contract when explicitly excluded
  from OpenAPI coverage.

### Auth

- Use the first-party Go auth API for all authentication.
- Do not reintroduce Kratos, Better Auth, NextAuth, or password auth without an
  explicit new plan.
- Protect server behavior through Go API auth middleware and the Next.js proxy
  boundary.
- Store sessions in Postgres through the first-party Go auth API.

### UI

- Preserve the terminal/editorial redesign and theme code from the `308371c`
  lineage.
- Theme tokens live in `apps/web/tailwind.config.ts` and CSS variables in
  `apps/web/src/app/globals.css` / `apps/web/src/app/editorial-theme.css`.
- Prefer existing tokens over hard-coded hex values.
- Reuse Radix primitives before introducing a new component library.
- Keep interactions keyboard-accessible, especially command palette and issue
  management flows.
- Dark mode is class-based. Style for both modes.

## Out of Scope

Do not add paywalls, subscription checkout, payment collection, or hosted SaaS
billing flows without an explicit approved plan.

The repo currently contains workspace billing/settings surfaces and a Stripe
webhook ingestion path. Treat those as existing product/admin surfaces unless
the requested work explicitly changes payment processing or monetization.

