# exponential Web App

`apps/web` is the Next.js 16 App Router UI for exponential. It should remain
UI-only for runtime business endpoints; the Go API owns `/v1/*`, and browser
traffic reaches it through same-origin `/api/*` rewrites.

## Local Development

From the repo root:

```bash
pnpm install
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

For host-run web development with local services:

```bash
make dev-services
EXPONENTIAL_API_DATABASE_URL=$DATABASE_URL go run ./apps/api/cmd/migrate
pnpm dev
```

The web app runs on `http://localhost:7015` by default. The dev script runs a
database preflight before binding; use `SKIP_DB_PREFLIGHT=true` only when
intentionally debugging a route that does not need the database.

## Boundaries

- Do not add new runtime business routes under `apps/web/src/app/api`.
- Use generated SDK clients for migrated runtime slices.
- Keep public marketing/auth/onboarding routes in the App Router.
- Keep protected app surfaces under `apps/web/src/app/(app)`.
- Preserve workspace-slug-compatible routes where existing app navigation
  expects them.

## UI Conventions

- Tailwind tokens live in `tailwind.config.ts`.
- Global CSS and editorial theme variables live in
  `src/app/globals.css` and `src/app/editorial-theme.css`.
- Reuse Radix primitives and existing app components before adding new UI
  dependencies.
- Keep keyboard access and command-palette flows intact.
- Style both light and class-based dark mode.

## Tests

```bash
pnpm --filter @exponential/web typecheck
pnpm --filter @exponential/web test
pnpm --filter @exponential/web test:e2e
```

Repo-level gates:

```bash
make check
make test
make test-e2e
```

Test conventions live in [tests/README.md](tests/README.md).
