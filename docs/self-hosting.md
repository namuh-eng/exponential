# Self-hosting exponential

exponential is self-hostable, but it is a split application rather than a
single Next.js container:

- `web` — Next.js UI-only app; same-origin `/api/*` requests are rewritten to the Go API.
- `api` — Go headless API on port `7016`.
- `api-migrate` — one-shot Go SQL migrations from `packages/proto/migrations`.
- `postgres` — PostgreSQL 15 data store.
- `redis` — Redis 7 cache/realtime store.

Use this guide for a Docker Compose install on one host. Use the AWS ECS scripts
when you want managed RDS/ElastiCache/S3/SES and load-balanced services.

## Requirements

- Docker Engine with the Compose plugin.
- Git.
- A host with enough memory to build the Next.js and Go images. 4 GiB is a
  practical minimum; 8 GiB is more comfortable.
- Optional: an S3-compatible AWS account for attachments and SES for email.

## Quick start: Docker Compose

```bash
git clone https://github.com/namuh-eng/exponential.git
cd exponential
cp .env.example .env

# Required: replace the sample values with random secrets.
openssl rand -hex 32 # use for EXPONENTIAL_SESSION_SECRET
$EDITOR .env

docker compose up --build
```

Open `http://localhost:7015`.

The default Compose stack publishes only the web app to all interfaces. Postgres,
Redis, and the API bind to `127.0.0.1` by default so they are available for local
admin/smoke checks without being exposed publicly.

## Required environment

For the Compose stack, `.env` must include:

| Variable | Purpose | Default/example |
| --- | --- | --- |
| `DB_PASSWORD` | Password for the bundled Postgres service. | `password` for local-only trials; change for shared hosts. |
| `EXPONENTIAL_SESSION_SECRET` | HMAC secret for browser session cookies. | Generate with `openssl rand -hex 32`. |
| `NEXT_PUBLIC_APP_URL` | Public URL users open in the browser. | `http://localhost:7015`. |
| `EXPONENTIAL_APP_URL` | Server-side canonical app URL. | Usually the same as `NEXT_PUBLIC_APP_URL`. |

If you run behind a reverse proxy, set both app URLs to your public HTTPS origin,
for example `https://issues.example.com`.

## Optional features

| Feature | Variables | Behavior when omitted |
| --- | --- | --- |
| Google OAuth | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google sign-in is disabled/unconfigured. |
| Attachments | `AWS_REGION`, `S3_BUCKET`, AWS credentials or an instance/task role | Attachment endpoints return service-unavailable until storage is configured. |
| Email | `SENDER_EMAIL`, `AWS_REGION`, AWS credentials or an instance/task role | In non-production, email previews can be written to `EMAIL_PREVIEW_PATH`; production email requires SES. |
| Slack integration | `AUTH_SLACK_ID`, `AUTH_SLACK_SECRET` | Slack OAuth is disabled/unconfigured. |
| Inbound email | `INBOUND_EMAIL_WEBHOOK_SECRET`, `EXPONENTIAL_INBOUND_DOMAIN` | Inbound email routes are not usable. |
| AI discussion summaries | `OPENAI_API_KEY`, `DISCUSSION_SUMMARY_PROVIDER=openai` | Summaries stay disabled/fallback-only. |

## Ports and bind addresses

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

## Health checks and smoke tests

After the stack is up:

```bash
curl http://localhost:7015/
curl http://localhost:7016/healthz
curl http://localhost:7016/metrics/red
```

If you have a personal access token, also smoke an authenticated endpoint
through the web app's same-origin API rewrite:

```bash
curl http://localhost:7015/api/issues?limit=1 \
  -H "Authorization: Bearer $EXPONENTIAL_TOKEN"
```

Note: direct operational health and RED metrics checks use the API port in the
plain Compose stack. In AWS ECS, the ALB routes public `/api/healthz` and
`/api/metrics/red` directly to the Go API before requests reach the web service.

## Data, backups, and upgrades

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

Upgrade from a newer checkout:

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d
```

The `api-migrate` job runs on startup and is safe to rerun. Always keep a
database backup before major version jumps.

## Reverse proxy notes

Terminate TLS at your proxy and forward HTTP to the web container on `WEB_PORT`.
Use these headers:

- `Host`
- `X-Forwarded-Proto`
- `X-Forwarded-For`

For direct client IP handling in the Go API, set `EXPONENTIAL_TRUSTED_PROXIES` to
trusted proxy or private subnet CIDRs. Do not set it to a broad public range.

## AWS ECS path

The repo also includes an AWS ECS deployment path:

```bash
cp .env.example .env
# Fill AWS_REGION, Google OAuth if needed, and owner-specific values.
bash scripts/prepare-ecs-deploy-env.sh
DB_PASSWORD=<generated-or-existing-password> bash scripts/preflight.sh
bash scripts/prepare-ecs-deploy-env.sh
RUN_PROD_SMOKE=true scripts/deploy-ecs.sh
```

`preflight.sh` provisions VPC networking, RDS, ElastiCache, S3, ECR, SES setup
when configured, target groups, and ALB routing. `deploy-ecs.sh` builds and
pushes the API and web images, runs migrations, updates ECS services,
waits for stability, and can run `scripts/smoke-prod.sh`.

## Development stack

For hot-reload development, use the separate dev stack:

```bash
docker compose -f docker-compose.dev.yml up --build
```

This uses bind mounts, development defaults, Mailhog, and Next.js dev mode. It is
not the recommended public self-hosting path.

## Known limitations

- Attachments require AWS S3-compatible credentials and `S3_BUCKET`; local disk
  attachment storage is not implemented.
- Production email is SES-oriented today.
- The checked-in Docker images are built locally from source. If you publish your
  own registry images, keep the split `web`, `api`, and schema/migration tasks.
