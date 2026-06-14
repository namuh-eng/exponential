# Self-hosting exponential

exponential is self-hostable as a split application:

- `web` — Next.js UI-only app. Same-origin `/api/*` requests are rewritten to
  the Go API.
- `api` — Go headless API on port `7016`.
- `api-migrate` — one-shot SQL migration runner using
  `packages/proto/migrations`.
- `postgres` — PostgreSQL 15 data store.
- `redis` — Redis 7 cache/realtime store.

Use Docker Compose for a single-host install. Use the AWS ECS scripts when you
want managed RDS, ElastiCache, S3, SES, ECR, ALB routing, and task-level
Secrets Manager wiring.

## Requirements

- Docker Engine with the Compose plugin.
- Git.
- 4 GiB RAM minimum; 8 GiB is more comfortable while building Next.js and Go
  images.
- Optional AWS or S3-compatible credentials for attachments.
- Optional SES or Opensend credentials for production email.

## Quick Start

```bash
git clone https://github.com/namuh-eng/exponential.git
cd exponential
cp .env.example .env

openssl rand -hex 32 # EXPONENTIAL_SESSION_SECRET
openssl rand -hex 32 # EXPONENTIAL_METRICS_TOKEN
$EDITOR .env

docker compose up --build
```

Open `http://localhost:7015`.

The default Compose stack publishes the web app to all interfaces. Postgres,
Redis, and the direct API port bind to `127.0.0.1` by default for local admin
and smoke checks without public exposure.

## First Sign-in

The production Compose stack runs the API with `NODE_ENV=production`, which
means magic-link sign-in only works once an email provider is configured.
Before exposing the instance to your team, configure at least one of:

- **Google sign-in** — set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` (requires
  an HTTPS public URL for the OAuth redirect).
- **Magic-link email** — set `SENDER_EMAIL` with SES credentials, or
  `SENDER_EMAIL` + `OPENSEND_API_KEY` for Opensend.

Without either, magic-link requests return `503` and there is no way to sign
in. For a quick local trial without any email or OAuth setup, use the
development stack instead (`docker compose -f docker-compose.dev.yml up
--build`): in non-production mode the API returns the magic-link URL directly
in the sign-in response, and Mailhog (`http://localhost:8025`) captures any
outbound mail.

## Required Environment

For Compose, set these in `.env` before exposing the instance:

| Variable | Purpose | Example |
| --- | --- | --- |
| `DB_PASSWORD` | Password for bundled Postgres. | Generate a real password for shared hosts. |
| `EXPONENTIAL_SESSION_SECRET` | HMAC secret for browser sessions. | `openssl rand -hex 32` |
| `EXPONENTIAL_METRICS_TOKEN` | Token for production RED metrics. The Compose stack runs the API with `EXPONENTIAL_API_ENVIRONMENT=production`, so `/metrics/red` returns `404` until this is set and sent via `X-Metrics-Token`. | `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | Browser-facing URL. | `https://issues.example.com` |
| `EXPONENTIAL_APP_URL` | Server-side canonical app URL. | Usually same as `NEXT_PUBLIC_APP_URL`. |

For local-only trials, `NEXT_PUBLIC_APP_URL` and `EXPONENTIAL_APP_URL` can stay
at `http://localhost:7015`.

## Optional Features

| Feature | Variables | Behavior when omitted |
| --- | --- | --- |
| Google sign-in | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth is unavailable. |
| Magic-link email | `SENDER_EMAIL` with SES, or `SENDER_EMAIL` + `OPENSEND_API_KEY` for Opensend | Production magic-link email returns unavailable. |
| Attachments | `AWS_REGION`, `S3_BUCKET`, AWS credentials or instance/task role | Attachment endpoints return service unavailable. |
| Slack integration | `AUTH_SLACK_ID`, `AUTH_SLACK_SECRET` | Slack installation is unavailable. |
| Inbound email | `INBOUND_EMAIL_WEBHOOK_SECRET`, `EXPONENTIAL_INBOUND_DOMAIN` | Inbound email routes cannot be used. |
| AI discussion summaries | `OPENAI_API_KEY`, `DISCUSSION_SUMMARY_PROVIDER=openai` | Summaries stay disabled/fallback-only. |
| Stripe webhooks | `STRIPE_WEBHOOK_SIGNING_SECRET` in API runtime, or ECS secret ARN | Billing webhook events are rejected. |

Email provider selection is automatic: `OPENSEND_API_KEY` selects Opensend,
`SENDER_EMAIL` alone selects SES, and `EMAIL_PROVIDER=ses|opensend` can force a
provider.

## Ports and Bind Addresses

| Variable | Default | Description |
| --- | --- | --- |
| `WEB_PORT` | `7015` | Host port for the web app. |
| `WEB_BIND` | `0.0.0.0` | Host bind address for the web app. |
| `API_PORT` | `7016` | Host port for direct API checks. |
| `API_BIND` | `127.0.0.1` | Host bind address for direct API checks. |
| `PG_PORT` | `15532` | Host port for Postgres admin/backup access. |
| `PG_BIND` | `127.0.0.1` | Host bind address for Postgres. |
| `REDIS_PORT` | `16379` | Host port for Redis admin access. |
| `REDIS_BIND` | `127.0.0.1` | Host bind address for Redis. |

Keep `API_BIND`, `PG_BIND`, and `REDIS_BIND` on loopback unless you have a
specific private-network reason to expose them.

## Health Checks

After the stack is up:

```bash
curl http://localhost:7015/
curl http://localhost:7016/healthz
curl http://localhost:7016/metrics -H "X-Metrics-Token: $EXPONENTIAL_METRICS_TOKEN"
curl http://localhost:7016/metrics/red -H "X-Metrics-Token: $EXPONENTIAL_METRICS_TOKEN"
```

If you have a personal access token, also smoke an authenticated endpoint
through the web app's same-origin API rewrite:

```bash
curl "http://localhost:7015/api/issues?limit=1" \
  -H "Authorization: Bearer $EXPONENTIAL_TOKEN"
```

Production metrics are intentionally token-gated. In ECS, `scripts/smoke-prod.sh`
uses `EXPONENTIAL_METRICS_TOKEN` or reads the token from `METRICS_TOKEN_SECRET_ARN`.

## Metrics Scraping

The Go API exposes Prometheus text metrics at `GET /metrics` and through the
web/ALB proxy at `GET /api/metrics`. The endpoint includes HTTP request
counters and latency histograms labeled by low-cardinality method, route
pattern, and status code. `/metrics/red` remains available as a JSON snapshot
for quick human checks, but it is in-process only and resets when a task
restarts.

For self-hosted Prometheus, scrape the API container directly on the private
network:

```yaml
scrape_configs:
  - job_name: exponential-api
    metrics_path: /metrics
    scheme: http
    static_configs:
      - targets: ["api:7016"]
    authorization:
      type: Bearer
      credentials: "<EXPONENTIAL_METRICS_TOKEN>"
```

If you scrape through the web or load balancer, use `metrics_path:
/api/metrics` and send the same token with either `Authorization: Bearer
<token>` or `X-Metrics-Token: <token>`. In ECS, run a CloudWatch Agent or OTel
Collector sidecar/service to scrape `/api/metrics` on each task or target and
remote-write/export to your metrics backend. The collector, Prometheus, or
CloudWatch workspace is the durable store that aggregates across task restarts
and multiple ECS tasks.

## Headless clients

The CLI and local MCP server use the Go API base URL and a personal access token:

```bash
export EXPONENTIAL_TOKEN=pat_your_token
export EXPONENTIAL_API_URL=http://localhost:7016/v1

expn doctor --json
expn issue ls --json
```

For MCP v0, configure clients to spawn the local stdio command. It exposes only
read-only tools and does not run an HTTP listener:

```bash
pnpm --filter @exponential/mcp exec exponential-mcp
```

See [CLI usage](cli.md) and [MCP v0](mcp.md).

## Reverse Proxy

Terminate TLS at your proxy and forward HTTP to the web container on `WEB_PORT`.
Forward these headers:

- `Host`
- `X-Forwarded-Proto`
- `X-Forwarded-For`

Set both app URLs to the public HTTPS origin:

```bash
NEXT_PUBLIC_APP_URL=https://issues.example.com
EXPONENTIAL_APP_URL=https://issues.example.com
PUBLIC_BASE_URL=https://issues.example.com
```

For direct client IP handling in the Go API, set
`EXPONENTIAL_TRUSTED_PROXIES` to trusted proxy or private subnet CIDRs. Do not
set it to a broad public range.

## Data and Backups

Compose stores durable data in named volumes:

- `postgres_data` — Postgres database files.
- `redis_data` — Redis append-only data.

Back up Postgres before upgrades:

```bash
docker compose exec -T postgres pg_dump -U postgres exponential > exponential.sql
```

Restore into an empty stack:

```bash
docker compose exec -T postgres psql -U postgres exponential < exponential.sql
```

## Upgrades

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d
```

The `api-migrate` job runs on startup and is safe to rerun. Keep a database
backup before major version jumps or before applying migrations from a large
change set.

## AWS ECS Path

The repo includes an AWS ECS deployment path:

```bash
cp .env.example .env
bash scripts/prepare-ecs-deploy-env.sh
DB_PASSWORD=<generated-or-existing-password> bash scripts/preflight.sh
bash scripts/prepare-ecs-deploy-env.sh
RUN_PROD_SMOKE=true scripts/deploy-ecs.sh
```

`preflight.sh` provisions networking, RDS, ElastiCache, S3, ECR, SES setup when
configured, target groups, ALB routing, and secret placeholders.
`deploy-ecs.sh` builds and pushes API/web images, runs migrations, updates ECS
services, waits for stability, and can run `scripts/smoke-prod.sh`.

### Production sizing

`scripts/preflight.sh` defaults to the lowest-cost data tier so trial stacks keep
the previous behavior: `db.t3.micro`, single-AZ RDS, `cache.t3.micro`, and a
single ElastiCache Redis node. For production, set the data-tier options before
running preflight:

```bash
DB_INSTANCE_CLASS=db.t4g.small \
DB_MULTI_AZ=true \
REDIS_NODE_TYPE=cache.t4g.small \
REDIS_REPLICATION_ENABLED=true \
DB_PASSWORD=<generated-or-existing-password> \
bash scripts/preflight.sh
```

| Variable | Default | Production guidance |
| --- | --- | --- |
| `DB_INSTANCE_CLASS` | `db.t3.micro` | Pick a class with enough memory and CPU for the workload, for example `db.t4g.small` or larger. Existing RDS instances are modified in place when this changes. |
| `DB_MULTI_AZ` | `false` | Set `true` for a standby in another AZ and automatic RDS failover. This raises cost and may briefly affect the instance while AWS applies the change. |
| `REDIS_NODE_TYPE` | `cache.t3.micro` | Pick a class large enough for session, cache, and realtime fanout load. Existing standalone clusters or replication groups are modified in place when this changes. |
| `REDIS_REPLICATION_ENABLED` | `false` | Set `true` to provision an ElastiCache replication group with one primary, one replica, Multi-AZ placement, and automatic failover. |

With `REDIS_REPLICATION_ENABLED=false`, preflight manages the legacy standalone
cluster named `exponential-redis`. A node restart can evict sessions and realtime
state. With `REDIS_REPLICATION_ENABLED=true`, preflight manages
`exponential-redis-rg` and writes `REDIS_URL` to the replication group's primary
endpoint. Preflight does not delete an existing standalone cluster when you
enable replication; keep it until the ECS services have been redeployed and the
new Redis endpoint has passed smoke checks.

Changing `DATABASE_URL` or `REDIS_URL` in `.env` is not enough for running ECS
tasks. Re-run `bash scripts/prepare-ecs-deploy-env.sh` so Secrets Manager is
updated, then deploy with `RUN_PROD_SMOKE=true scripts/deploy-ecs.sh`.

### RDS point-in-time restore runbook

RDS backups are retained for seven days by preflight. Exercise this runbook after
the initial production deployment and after major data-tier changes. Record the
date, source instance, restore target, validation result, and rollback endpoint
in your operator notes.

1. Capture the current endpoint and latest restorable time:

   ```bash
   aws rds describe-db-instances \
     --db-instance-identifier exponential-db \
     --region "$AWS_REGION" \
     --query 'DBInstances[0].[Endpoint.Address,LatestRestorableTime]' \
     --output table
   ```

2. Restore to a new private RDS instance. Use `--restore-time` with an ISO 8601
   timestamp for a specific point, or `--use-latest-restorable-time` for a drill:

   ```bash
   RESTORE_ID="exponential-db-restore-$(date +%Y%m%d%H%M)"
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier exponential-db \
     --target-db-instance-identifier "$RESTORE_ID" \
     --use-latest-restorable-time \
     --db-instance-class "${DB_INSTANCE_CLASS:-db.t3.micro}" \
     --db-subnet-group-name exponential-db-subnet \
     --vpc-security-group-ids "$DB_SG" \
     --no-publicly-accessible \
     --region "$AWS_REGION"
   aws rds wait db-instance-available \
     --db-instance-identifier "$RESTORE_ID" \
     --region "$AWS_REGION"
   ```

   Add `--multi-az` when the restored instance should immediately match a
   Multi-AZ production target.

3. Validate the restored database from the VPC, using a bastion, VPN, or one-off
   ECS task with network access to the private subnets:

   ```bash
   RESTORE_ENDPOINT=$(aws rds describe-db-instances \
     --db-instance-identifier "$RESTORE_ID" \
     --region "$AWS_REGION" \
     --query 'DBInstances[0].Endpoint.Address' \
     --output text)
   psql "postgresql://postgres:${DB_PASSWORD}@${RESTORE_ENDPOINT}:5432/exponential" \
     -c 'select count(*) from workspaces;'
   ```

4. Cut over by updating the database secret and redeploying. Keep the old
   endpoint value for rollback:

   ```bash
   OLD_DATABASE_URL="$DATABASE_URL"
   export DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@${RESTORE_ENDPOINT}:5432/exponential"
   bash scripts/prepare-ecs-deploy-env.sh
   RUN_PROD_SMOKE=true scripts/deploy-ecs.sh
   ```

5. Roll back by restoring `OLD_DATABASE_URL`, re-running
   `scripts/prepare-ecs-deploy-env.sh`, and redeploying. After the restored stack
   is stable and the backup window has elapsed, delete abandoned restore
   instances explicitly; preflight never deletes RDS instances.

For ECS web-to-API server requests, prefer `WEB_INTERNAL_API_URL` pointing at
the internal ALB/API route so server-side auth/session checks do not hairpin
through a public CDN or proxy hostname.

## Development Stack

For hot-reload development, use the dev stack:

```bash
docker compose -f docker-compose.dev.yml up --build
```

This uses bind mounts, development defaults, Mailhog, and Next.js dev mode. It
is not the recommended public self-hosting path.

## Known Limitations

- Attachment storage is S3-oriented; local disk attachment storage is not
  implemented.
- Production email requires SES or Opensend configuration.
- Compose builds local images from source. If you publish your own registry
  images, keep the split `web`, `api`, and migration tasks.
- ELv2 permits self-hosting and internal modification, but it does not permit
  offering exponential as a hosted service to third parties.
