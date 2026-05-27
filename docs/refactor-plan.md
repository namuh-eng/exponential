# Refactor Plan: Headless API + Go Split

**Owner:** jaeyunha
**Status:** Ready for implementation
**Branch:** `headless-api-go-split`
**Date:** 2026-05-24

---

## Goal

Turn this codebase from a Next.js monolith into a **headless API-first SaaS** so a CLI, web frontend, and (later) third-party integrations all consume the same backend as equal peers.

Performance, scalability, and a clean public contract are non-negotiable. Production deployment has **not happened yet** — nothing is locked in.

---

## Current state (as of this branch)

- **Stack:** Next.js 16 App Router (frontend + API routes in one process), TypeScript strict, Postgres (AWS RDS), Redis (ElastiCache), Better Auth (Google OAuth + magic links), AWS S3/SES.
- **API surface:** ~30+ route folders under `src/app/api/` (account, agent, analytics, auth, comments, custom-emojis, document-folders, document-settings, document-templates, inbound, …).
- **Deploy target:** AWS ECS Fargate + ALB — provisioning script at `scripts/preflight.sh`, **not yet executed**.
- **Tests:** Vitest unit tests + Playwright E2E (`tests/`).
- **`packages/sdk/`** referenced in `CLAUDE.md` but does **not** exist on disk.

---

## Target architecture

```
apps/
  web/      Next.js — UI only, consumes generated TS SDK
  api/      Go + chi + pgx + sqlc — REST + OpenAPI, includes WS module
  cli/      Bun (or Node) — consumes generated TS SDK
packages/
  sdk/      auto-generated TS client from OpenAPI
  proto/    OpenAPI spec + SQL migrations — single source of truth
infra/
  docker/   docker-compose for local dev (postgres, redis, api, web)
```

**Two deployables initially:** `apps/api` (stateless, ALB-fronted, autoscales) and `apps/web` (static-ish edge/Node). Sync engine lives **inside `apps/api`** as a WebSocket module until measured load justifies extraction.

---

## Key decisions (these are locked unless evidence appears)

These were validated via independent review (Codex consult). Do not relitigate without new evidence.

| Decision | Rationale | What we rejected |
|---|---|---|
| **Go + chi + pgx + sqlc** for API | Fast enough (~80k RPS/core), DB is the real ceiling, predictable, mature ecosystem, fast dev velocity | Rust (over-engineering for HTTP layer); TS/Hono (would block real perf gains and keep monolith inertia) |
| **WebSocket sync inside Go API** as module | Polyglot ops cost is real on day 1. Go WS libs are fast enough. Extract to Rust only if metrics demand. | Separate Rust sync service from day 1 (cargo-culted) |
| **OpenAPI 3.1** as contract | CLI-first consumption demands stable curlable REST. SDK generated from spec. | gRPC / Connect-RPC (heavier CLI ergonomics); tRPC (TS-locked, kills CLI portability) |
| **First-party Go auth** for auth | Owner override after implementation review: avoid a separate auth server. Use standard Go libraries (`golang.org/x/oauth2`, `go-oidc`), opaque HttpOnly sessions backed by the existing `session` table, magic-link tokens in `verification`, and PATs for CLI. | separate auth server (too much operational/product weight for current scope); custom password auth as first slice; Casdoor/Hydra |
| **sqlc + SQL-first migrations** | Cross-language schema ownership creates drift. SQL is the single truth; Go types and TS types both generated from it. | Keeping a web-owned schema authority (drift); ent/bun (worse fit for schema-driven flow) |
| **Op log + monotonic versions** for sync | Linear-style delta sync needs ordered, idempotent, replayable deltas. CRDTs add complexity for conflicts a tracker doesn't need. | CRDTs (overkill); naive event broadcast + refetch (poor UX) |

---

## Phased migration

Each phase is independently shippable. Do **not** start phase N+1 until phase N is verified.

### Phase 0 — Scaffolding (½ day)

- [ ] Create monorepo layout: `apps/`, `packages/`, `infra/`
- [ ] Set up `pnpm` workspaces (or keep `npm` if simpler — pick one, stick with it)
- [ ] Move existing Next.js code into `apps/web/` (keep working, no behavior change)
- [ ] Initialize `apps/api/` as Go module: `chi`, `pgx`, `sqlc`, `zap` (logging), `viper` (config)
- [ ] Wire up `docker-compose.dev.yml` with: postgres, redis, api, web
- [ ] CI: ensure Next.js still builds, Go builds, tests still pass

**Verification:** `make check && make test` green; `docker compose up` boots all services; web app still works against existing Next.js API routes.

### Phase 1 — Contract + first vertical slice (1 day)

- [ ] Author **OpenAPI 3.1** spec at `packages/proto/openapi.yaml` for **one resource** — recommend `issues` (most representative, hits most patterns)
- [ ] Generate Go server stubs from spec (`oapi-codegen`)
- [ ] Generate TS client from spec (`openapi-typescript` + `openapi-fetch`) → `packages/sdk/`
- [ ] Implement `issues` CRUD in `apps/api`: list (cursor pagination), get, create (with `Idempotency-Key` header), update, delete
- [ ] Write `sqlc` queries + types from existing Postgres schema
- [ ] Add Go unit tests + integration test against a real Postgres (testcontainers or docker-compose)
- [ ] **Web app continues using Next.js API for everything else** — but switch `issues` calls to `packages/sdk/`

**Verification:** Web app's issues page works identically against Go API. CLI prototype (curl + jq is fine) round-trips an issue.

### Phase 2 — First-party Go auth (½–1 day)

- [ ] Implement Google OAuth/OIDC in `apps/api` with `golang.org/x/oauth2` + `go-oidc`
- [ ] Preserve existing Better Auth-compatible `user`, `account`, `session`, and `verification` records; add idempotent migration only if schema drift requires it
- [ ] `apps/api` validates opaque HttpOnly session cookies against the `session` table on every request
- [ ] Implement **Personal Access Tokens (PATs)** in `apps/api` for CLI auth — `pat_` prefix, hashed at rest, scopes, revocation, audit log
- [ ] `apps/web` swaps Better Auth UI calls for first-party Go auth routes
- [ ] Update middleware in `apps/web` to recognize the first-party session cookie for protected pages

**Verification:** Google OAuth login works end-to-end on web. Magic link delivered via SES, login completes. CLI can authenticate with a PAT and call `GET /issues`. Old Better Auth code path deleted.

### Phase 3 — Port remaining routes (1–2 days, parallelizable)

Port these in priority order (each is a vertical slice — handler + sqlc queries + tests + SDK regen):

1. workspaces, members, invitations
2. projects, milestones, cycles
3. comments, reactions, custom-emojis
4. documents, document-folders, document-settings, document-templates
5. attachments (S3 presigned URLs)
6. notifications, inbound (email-to-issue via SES)
7. analytics, agent, account settings

For each:
- [ ] Add to OpenAPI spec
- [ ] Generate stubs, implement handler, write sqlc queries
- [ ] Add Go tests
- [ ] Regenerate SDK
- [ ] Switch web app callsites to SDK
- [ ] Delete corresponding `src/app/api/<route>/` from `apps/web`

**Stop condition:** `src/app/api/` is empty. Next.js is UI-only.

### Phase 4 — Realtime sync (1–2 days)

- [ ] Design the **op log**: `operations` table (id, workspace_id, entity_type, entity_id, op_type, payload, version, created_at, created_by)
- [ ] Every mutation in `apps/api` writes to op log atomically with the entity update (single transaction)
- [ ] WebSocket endpoint at `apps/api`: `/v1/sync/ws` — client sends last-known `version`, server streams deltas since
- [ ] Redis pub/sub fans out new ops to connected WS clients in same workspace
- [ ] Client SDK: reconnect with backoff, replay from last `version`, idempotent apply
- [ ] Web app subscribes via SDK; CLI can `--watch` (long-poll or WS, either works)

**Verification:** Two browser tabs see each other's edits in <500ms. CLI `--watch` streams updates. Disconnect/reconnect replays missed ops without dupes.

### Phase 5 — Deploy + observability (1 day)

- [ ] `apps/api` Dockerfile (multi-stage, distroless, ~30MB image)
- [ ] ECS task definitions: api (autoscale), web (autoscale)
- [ ] ALB routes: `/api/*` → api service, everything else → web service
- [ ] ALB routes `/api/*` to the Go API and all other app traffic to web
- [ ] OpenTelemetry: traces from web → api → postgres, exported to whatever (CloudWatch / Honeycomb / etc.)
- [ ] Structured logs (zap JSON) → CloudWatch
- [ ] RED metrics: req rate, error rate, duration p50/p95/p99 per endpoint
- [ ] Run `scripts/preflight.sh` to provision real AWS infra

**Verification:** Smoke test against prod URL. Traces show full request path. Alerts wired up.

---

## Hard parts (do not under-estimate these)

Codex flagged these. Treat as risk areas:

1. **Auth migration is the highest-risk step.** Preserving existing user/session/account semantics while moving flows into Go is product-critical. Test exhaustively: existing users must log in without password reset, OAuth-linked accounts must stay linked, magic link tokens in flight must work or fail gracefully.
2. **Authorization boundaries.** Better Auth's session shape leaks into existing handlers. When porting to Go, define a single `Authz` interface in `apps/api/internal/authz/` and force every handler through it. No ad-hoc permission checks.
3. **OpenAPI coverage validation.** A route ported without a spec entry is a contract regression. CI must enforce: every Go handler is referenced from `packages/proto/openapi.yaml`, every spec path has a handler. Use `oapi-codegen --generate strict-server` to make this compile-time.
4. **Dev velocity during dual-stack.** Web team still works on `apps/web` while API team ports routes. Avoid blocking: web keeps using SDK; if SDK doesn't have the endpoint yet, web falls back to remaining Next.js API route (don't delete prematurely).
5. **Migration script idempotency.** The auth migration script must be re-runnable. Drift between staging and prod data is real.

---

## CLI-specific requirements (bake in from Phase 1)

- **PAT auth:** `Authorization: Bearer pat_<token>`. Scopes per token. Revocable. Auditable.
- **Idempotency keys:** All mutations accept `Idempotency-Key` header. Server stores key + response for 24h.
- **Cursor pagination:** Never offset. Always cursor. Return `next_cursor` in response.
- **Rate limiting:** Per-token, not per-IP. Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- **JSON only:** No HTML responses. Errors follow RFC 7807 (problem+json).
- **Versioning:** Path-based `/v1/`. Breaking changes bump to `/v2/`.

---

## Tooling decisions (pick one each, don't relitigate mid-port)

| Concern | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Lightest, fast caching |
| Go HTTP | chi | Stdlib-style routing, no magic |
| Go DB | pgx + sqlc | Fastest, type-safe, no ORM tax |
| Go config | viper + env | Standard |
| Go logging | zap (structured JSON) | Fast, ergonomic |
| Go testing | stdlib + testify | Boring is good |
| OpenAPI codegen (Go) | `oapi-codegen` (strict-server mode) | Best in class |
| OpenAPI codegen (TS) | `openapi-typescript` + `openapi-fetch` | Tiny, no runtime bloat |
| Migrations | `goose` | SQL files, simple |
| Auth | First-party Go auth (`oauth2`, `go-oidc`, opaque DB sessions) | Standard Go stack without a separate auth server |
| Realtime | nhooyr/websocket (Go) | Modern, ergonomic |
| Local dev | docker-compose | Same as today |
| CI | existing | No change |

---

## Out of scope (do not do these now)

- Rust anywhere. Revisit only if WS service hits real bottlenecks measured in production.
- gRPC. OpenAPI REST is the contract.
- CRDTs for sync. Op log first.
- Splitting sync into its own service. Lives in `apps/api` until metrics say otherwise.
- Multi-region. Single region until we have paying customers there.
- Federation / SAML / SCIM. Add when enterprise asks.
- Billing, paywalls, payments (explicitly out of project scope per `CLAUDE.md`).

---

## Definition of done for this refactor

- [ ] `src/app/api/` is empty
- [ ] `apps/api` (Go) serves 100% of business endpoints
- [ ] OpenAPI spec at `packages/proto/openapi.yaml` is the contract
- [ ] `packages/sdk/` is auto-generated and used by both `apps/web` and `apps/cli`
- [ ] First-party Go auth handles Google OAuth, magic links, browser sessions, and PATs
- [ ] CLI in `apps/cli` can: login (PAT), list/create/update/delete issues, watch realtime
- [ ] All existing Vitest + Playwright tests pass
- [ ] New Go integration tests pass
- [ ] Deployed to AWS ECS (api + web), reachable behind ALB
- [ ] Observability: traces + RED metrics live

---

## Handoff notes for next agent

You are picking this up in worktree `/Users/jaeyunha/wt/exponential/headless-api-go-split` on branch `headless-api-go-split` (branched from `staging`).

**Start with Phase 0.** Do not skip ahead. Each phase ends with explicit verification — do not declare a phase done without running the verification.

The owner is impatient and wants real progress in days, not weeks. Move fast, but **do not skip the auth migration testing** (Phase 2) or the OpenAPI CI gate (Phase 1) — those two things are how this avoids becoming a regression nightmare.

When you hit a decision point that isn't in this doc, **stop and ask** rather than guess. The "Key decisions" table above is locked; everything else is up for discussion.

Run `make check && make test` before every commit. Small commits, one concern each.
