# Contributing to exponential

Thanks for helping improve exponential. This repo is a split monorepo: a Go
headless API, a Next.js UI, a generated TypeScript SDK, and a CLI. The
contribution path below is written for the current architecture, not the older
single-app prototype.

## Start Here

Before making changes, skim:

- [README.md](README.md) for product scope and local setup options.
- [CLAUDE.md](CLAUDE.md) for architecture, auth, and quality guardrails.
- [docs/README.md](docs/README.md) for the documentation map.
- [docs/self-hosting.md](docs/self-hosting.md) for Docker and ECS deployment.
- [docs/secrets.md](docs/secrets.md) for the optional 1Password workflow.
- [apps/web/tests/README.md](apps/web/tests/README.md) for test conventions.

## Project Shape

- `apps/api/` - Go API, auth, handlers, OpenAPI strict server stubs, sqlc
  queries, and migration runner.
- `apps/web/` - Next.js 16 App Router UI. Runtime business endpoints should
  not be added under `apps/web/src/app/api/`; the Go API owns `/api/*` and
  `/v1/*`.
- `apps/cli/` - CLI that consumes the generated SDK.
- `packages/proto/` - OpenAPI contract and SQL migrations.
- `packages/sdk/` - generated TypeScript SDK plus small hand-written helpers.
- `infra/` and `scripts/` - Docker, ECS, validation, smoke, and deploy helpers.

## Prerequisites

- Node.js 20+
- pnpm 10.24.0, via Corepack or your package manager
- Go, for `apps/api`
- Docker Desktop, for the local Postgres/Redis/API/web stack
- Playwright Chromium, for E2E tests

```bash
corepack enable
pnpm install
pnpm exec playwright install chromium
```

## Local Development

The default local ports are:

- Web: `http://localhost:7015`
- API: `http://localhost:7016`

### Full Docker Dev Stack

This starts Postgres, Redis, the Go API, the Next.js web app, and Mailhog.

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

### Host Dev Server With Docker Services

Use this when you want faster web/API iteration from your shell.

The fastest path is a single command that starts the Docker infra services
(Postgres/Redis + migrations), the Go API with hot reload, and the web app:

```bash
cp .env.example .env
make dev-full
```

`make dev-full` runs the API on port `7016` and the web app on `7015`. Ctrl-C
stops the API and web; the Docker services keep running (stop them with
`make dev-services-down`).

For hot reload of the Go API, install [air](https://github.com/air-verse/air)
once (`go install github.com/air-verse/air@latest`). Without it, the API still
runs but does not auto-restart on Go changes.

If you prefer separate terminals, run the pieces yourself:

```bash
cp .env.example .env
make dev-services   # Postgres + Redis + migrations
make dev-api        # Go API on :7016 (hot reload via air)
pnpm dev            # web app on :7015
```

`pnpm dev` starts the web app on port `7015` and preflights the database before
binding. Only set `SKIP_DB_PREFLIGHT=true` when intentionally debugging a
route that does not need the database.

### Regenerating Contract Code

After changing `packages/proto/openapi.yaml` or SQL queries, regenerate the
sqlc queries, Go OpenAPI stubs, and TypeScript SDK in one step:

```bash
make codegen
```

### Optional 1Password Flow

If you have access to the Exponential vault, you can run commands through
`.env.1password` instead of maintaining local secret values:

```bash
make op-doctor
make dev-op
```

See [docs/secrets.md](docs/secrets.md) for details.

## Development Workflow

1. Create a focused branch:

```bash
git switch -c fix/short-description
```

2. Make one logical change.
3. Update source, generated artifacts, tests, and docs together.
4. Run the relevant focused tests while iterating.
5. Run the merge gates before opening a PR.

Use these branch prefixes when they fit: `feat/`, `fix/`, `docs/`,
`refactor/`, `test/`, or `chore/`.

## Architecture Rules

### API and SDK

- OpenAPI is the contract for Go business endpoints. Update
  `packages/proto/openapi.yaml` when adding or changing public API behavior.
- Regenerate and commit generated SDK/stub/sqlc changes when the contract or
  SQL queries change.
- Keep Go handlers small, use context-aware DB calls, and return RFC
  7807-style JSON problems for API errors.
- Browser traffic is proxied to the Go API through `/api/*`; SDK/CLI clients
  use `/v1/*`.

### Web App

- Keep `apps/web` UI-only for runtime business endpoints.
- Use the generated SDK for migrated runtime slices instead of hand-written
  endpoint fetches.
- Preserve the terminal/editorial redesign and existing theme tokens.
- Reuse Radix primitives and Tailwind tokens before introducing new UI
  dependencies or hard-coded colors.
- Keep interactions keyboard-accessible, especially command-palette and issue
  management flows.

### Auth

Authentication is first-party Go auth. Do not reintroduce Kratos, Better Auth,
NextAuth, or password auth without an explicit new plan. Current auth surfaces
include Google OAuth, magic links, sessions, and workspace invitations.

### Out of Scope

Do not add paywalls, subscription checkout, payment collection, or hosted SaaS
billing flows unless there is an explicit approved plan for that work. Existing
workspace billing/settings and Stripe webhook code are current admin/provider
surfaces; changes there should stay narrowly scoped and documented.

## Verification

Run these before committing code changes:

```bash
make check
make test
```

Before declaring UI/runtime flows verified, also run:

```bash
make test-e2e
```

`make all` runs `make check` and `make test`. It does not run Playwright E2E.

For UI changes, manually open the affected page at `http://localhost:7015` and
exercise the golden path plus at least one edge case. For deployment changes,
run the deploy path with production smoke enabled:

```bash
RUN_PROD_SMOKE=true scripts/deploy-ecs.sh
```

Then verify ECS, ALB, and smoke-test output. A pushed commit is not the same
thing as a deployed and live-verified change.

## Test Guide

- Go API tests: `cd apps/api && go test ./...` or `make test`.
- Vitest unit/component tests: `pnpm test` or `make test`.
- SDK tests: `pnpm --filter @namuh-eng/expn-sdk test`.
- CLI tests: `pnpm --filter @namuh-eng/expn-cli test`.
- Playwright E2E: `make test-e2e`, with the dev stack running.

Run a single E2E file from the web package when iterating:

```bash
pnpm --filter @exponential/web test:e2e -- tests/e2e/smoke.spec.ts
```

Use Playwright debug or headed mode when a browser interaction is unclear:

```bash
pnpm --filter @exponential/web exec playwright test --debug
pnpm --filter @exponential/web exec playwright test --headed
```

## Code Style

- TypeScript strict mode: no `any` and no `as unknown as` shortcuts.
- Prefer real types and narrow helpers over type assertions.
- Biome owns formatting and linting.
- Keep Go code idiomatic, small, and explicit.
- Do not weaken or delete tests to make a change pass.

Useful commands:

```bash
make check
make fix
make format
```

## Pull Requests

Before opening a PR:

```bash
git fetch origin
git rebase origin/main
make check
make test
make test-e2e
```

In the PR description, include:

- What changed.
- Why it changed.
- User-visible behavior, if any.
- Tests and manual verification performed.
- Screenshots or short clips for visual UI changes.
- Any deploy or migration steps.

Main is protected, so land changes through a branch and PR. If your branch
needs updates after review, rebase carefully and force-push with lease:

```bash
git push --force-with-lease origin your-branch
```

## Commit Messages

Keep commits small and focused. Use a short conventional prefix:

```text
feat: add issue priority filter
fix: preserve callback URL after auth completion
docs: refresh local development guide
test: cover project milestone actions
```

Avoid vague commits like `fix stuff`, broad mixed changes, or unrelated
formatting churn.

## Common Troubleshooting

### The Web App Exits Before Starting

The web dev script preflights Postgres. Start the local services and apply
migrations:

```bash
make dev-services
EXPONENTIAL_API_DATABASE_URL=$DATABASE_URL go run ./apps/api/cmd/migrate
pnpm dev
```

### E2E Auth Is Failing

Playwright creates test sessions through the test-only helper under
`/api/test/create-session`. Make sure the local web app is running on `7015`,
the API is reachable on `7016`, and migrations have been applied.

### `make check` Fails On Generated Or Cache Files

Do not edit generated outputs by hand. Regenerate the relevant SDK, OpenAPI,
sqlc, or stub artifacts. If the failure points at a stale local cache, clean
the cache and rerun the check:

```bash
make clean
make check
```

### Docker Is Not Available

Use host Postgres and Redis, then set `DATABASE_URL` and `REDIS_URL` in your
environment or `.env`. Apply migrations with the Go migration runner before
starting the app.

## Need Help?

- Open a GitHub issue for bugs or feature requests.
- Use GitHub Discussions for questions.
- For deployment and self-hosting, start with [docs/self-hosting.md](docs/self-hosting.md).

Thank you for contributing to exponential.
