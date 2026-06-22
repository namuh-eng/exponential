# exponential Go API

The Go API is the headless backend for exponential. It is mounted directly on
`/v1/*` for SDK/CLI clients and behind the web/ALB `/api/*` prefix for browser
traffic.

## Local Checks

```bash
curl http://localhost:7016/healthz
curl http://localhost:7016/metrics -H "X-Metrics-Token: $EXPONENTIAL_METRICS_TOKEN"
curl http://localhost:7016/metrics/red -H "X-Metrics-Token: $EXPONENTIAL_METRICS_TOKEN"
curl http://localhost:7016/api/healthz
curl http://localhost:7016/api/metrics -H "X-Metrics-Token: $EXPONENTIAL_METRICS_TOKEN"
```

`/metrics` and `/api/metrics` return Prometheus text metrics for durable
scraping and aggregation. `/metrics/red` remains a JSON, in-process RED
snapshot for quick debugging. Metrics endpoints are open outside production and
require `EXPONENTIAL_METRICS_TOKEN` in production.

Runtime configuration uses `EXPONENTIAL_API_*` variables for process settings
such as `EXPONENTIAL_API_DATABASE_URL`, `EXPONENTIAL_API_REDIS_URL`, and
`EXPONENTIAL_API_ADDR`. Auth, OAuth, attachment, and inbound-email feature flags
are shared with the web process through the root `.env`; see `.env.example` and
`docs/self-hosting.md`.

## Contract Workflow

Public business endpoints are described in
`packages/proto/openapi.yaml`. The generated strict server stubs live in
`apps/api/internal/openapi/openapi.gen.go`.

When changing public API behavior:

1. Update `packages/proto/openapi.yaml`.
2. Regenerate Go OpenAPI stubs:

```bash
scripts/generate-go-openapi.py
```

3. Regenerate the TypeScript SDK:

```bash
bun run --filter @namuh-eng/expn-sdk generate
```

4. Run the guard suite:

```bash
make check
make test
```

Inbound provider callbacks, such as Stripe webhooks, may be mounted without
being part of the public SDK contract when they are explicitly excluded by
`scripts/check-openapi-coverage.mjs`.

## Database and Migrations

SQL migrations live in `packages/proto/migrations`. The migration binary is
`apps/api/cmd/migrate`.

Local migration example:

```bash
EXPONENTIAL_API_DATABASE_URL=$DATABASE_URL go run ./apps/api/cmd/migrate
```

sqlc query files live under `apps/api/internal/sqlc/queries`, and generated
types live under `apps/api/internal/sqlc/generated`. If sqlc generation is
stale, `make check` prints the exact generation command.

## Auth and Errors

Auth is first-party Go auth. Browser requests arrive through `/api/*` rewrites;
headless clients use `Authorization: Bearer pat_<token>` against `/v1/*`.

Handlers should return RFC 7807-style JSON problems through
`apps/api/internal/problem` and avoid leaking tokens, cookies, signatures, or
secret values in logs and responses.

## Focused Test Commands

```bash
cd apps/api && go test ./...
cd apps/api && go test ./internal/issues ./internal/workspaces
```
