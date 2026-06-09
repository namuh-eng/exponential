# Testing Standards

Conventions for unit and integration tests in this repo. Audit-driven — every
rule below traces back to a real failure class we cleaned up.

## What lives where

- `tests/*.test.ts(x)` — Vitest unit and route-handler tests. Run with `make test`.
- `tests/e2e/` — Playwright end-to-end tests. Run with `make test-e2e` (needs a dev server).
- `tests/_helpers/` — shared fixtures. Keep these tiny and dependency-light.
- `tests/vitest.setup.ts` — global Vitest setup, auto-loaded via `vitest.config.ts`.

## The cross-cutting helper

This exists because we hit the same failure modes ~20 times before centralizing.
Reach for it before reinventing.

### `tests/vitest.setup.ts`

Auto-loaded for every test file. Provides:

1. `@testing-library/jest-dom/vitest` matchers (`toBeInTheDocument`,
   `toHaveAttribute`, …). **Do not re-import this in individual files** —
   adding it locally is fine but redundant; omitting it is fine because the
   setup file already added it.
2. An in-memory `localStorage` / `sessionStorage` polyfill. Vitest 4's
   jsdom ships these as objects with `undefined` `setItem`/`getItem`/`clear`,
   which crashes any component that touches storage on mount.

If your test uses storage, just use it. The polyfill is transparent.

## Conventions

### Mocks live at the top of the file, before any source-of-truth imports

Vitest hoists `vi.mock` calls but does **not** hoist the variables they
reference. Use `vi.hoisted` for shared mock fns:

```ts
const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));
```

### One mock per module — no duplicates

Vitest applies the **last** `vi.mock` for a given module path and silently
ignores earlier ones. If you find two `vi.mock("@/foo", …)` calls in a file,
the first one is dead code and any state it tracked is a bug waiting to
happen. Consolidate.

### Mock the exact module surface — including new exports

When a source module gains an export (`resolveRequestWorkspaceId`,
`validateWebhookUrl`, …), every test that mocks that module starts failing
with `No "<name>" export is defined on the mock`. Add the new export to the
mock factory, not as a `mockImplementation` patch — keep the surface in one
place.

### Don't assert behavior that the source can't produce

If `withWorkspaceSlug(path, null)` returns `path` unchanged, an assertion
expecting `"/foreverbrowsing/foo"` when the slug is null isn't testing
behavior — it's testing a value we made up. When a source contract changes
(e.g. response shape, returned-status-code), update the assertions to the new
contract or delete the test. Don't comment-out, don't `it.skip`.

### Stale assertions are bugs

A `waitFor` block that asserts X, followed by a bare assertion that asserts
not-X, is always a stale leftover from a refactor. Delete the obsolete one.

### Schema drift kills more time than test framework drift

The recurring-issues route changed from `{cadence, startDate, time}` to
`{cadenceConfig, startAt}`; tests didn't update for a release cycle, and
every CI run wasted ~3s confirming the same drift. When you change a
public-ish input shape (API body, mock-record shape), grep for the field
name and update both source and tests in the same commit.

## How to add a new test

1. Pick the layer: unit (a function), component (a React tree), route
   handler (an API route), or E2E (full app via Playwright).
2. If it needs real persistence: prefer an API-level or Playwright scenario
   against the Go API instead of importing database clients from web tests.
3. If it renders a component that uses storage / portals / jest-dom matchers:
   you get the setup for free — no extra imports.
4. Mock from the outside in: mock the *modules* the unit-under-test imports,
   not the implementations inside them.
5. Prefer `toMatchObject` over deep-equality for objects with timestamps or
   generated IDs.

## Running tests

```sh
make test                  # Vitest, fast — skips DB suites
make test-e2e              # Playwright; needs `npm run dev` running
make check                 # Biome (lint + format) + tsc
make all                   # check + test
```

If `make test` is green and `make check` is green, the PR is ready for review.
