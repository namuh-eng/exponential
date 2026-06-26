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

Pre-built multi-arch images (`linux/amd64` and `linux/arm64`) are published to
the GitHub Container Registry on every release:

- `ghcr.io/namuh-eng/exponential-api:latest`
- `ghcr.io/namuh-eng/exponential-web:latest`

## Requirements

- Docker Engine with the Compose plugin.
- 2 GiB RAM minimum (image-based path); 8 GiB if building from source.
- Optional AWS or S3-compatible credentials for attachments.
- Optional SMTP relay, SES, or Opensend credentials for production email.

## Quick Start (pre-built images — recommended)

The image-based path pulls pre-built images from GHCR and is ready in under
five minutes on any machine with Docker. No compiler or Node.js required.

```bash
# Replace v1.2.3 with the release tag you want to run (see Releases on GitHub).
# Using the matching tag ensures the .env variables align with the image you pull.
IMAGE_TAG=v1.2.3
curl -fsSL "https://raw.githubusercontent.com/namuh-eng/exponential/${IMAGE_TAG}/.env.example" -o .env

# Fill in the required secrets (see Required Environment below)
openssl rand -hex 32  # paste as EXPONENTIAL_SESSION_SECRET
openssl rand -hex 32  # paste as EXPONENTIAL_METRICS_TOKEN
openssl rand -base64 32  # paste as EXPONENTIAL_PROVIDER_CREDENTIAL_ENCRYPTION_KEY
$EDITOR .env

docker compose -f docker-compose.images.yml up
```

Open `http://localhost:7015`.

To change the release tag, update `IMAGE_TAG` in `.env` and run
`docker compose -f docker-compose.images.yml pull && docker compose -f docker-compose.images.yml up -d`.

## Quick Start (build from source)

If you prefer to build the images locally from the full source tree (requires
Git, ~8 GiB RAM, and 10–20 minutes):

```bash
git clone https://github.com/namuh-eng/exponential.git
cd exponential
cp .env.example .env

openssl rand -hex 32 # EXPONENTIAL_SESSION_SECRET
openssl rand -hex 32 # EXPONENTIAL_METRICS_TOKEN
openssl rand -base64 32 # EXPONENTIAL_PROVIDER_CREDENTIAL_ENCRYPTION_KEY
$EDITOR .env

docker compose up --build
```

The default Compose stack publishes the web app to all interfaces. Postgres,
Redis, and the direct API port bind to `127.0.0.1` by default for local admin
and smoke checks without public exposure.

## First Sign-in

The production Compose stack runs the API with `NODE_ENV=production`, which
means magic-link sign-in only works once an email provider is configured.
Before exposing the instance to your team, configure at least one of:

- **Google sign-in** — set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` (requires
  an HTTPS public URL for the OAuth redirect).
- **GitHub sign-in** — set `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` (requires
  an HTTPS public URL for the OAuth redirect).
- **Magic-link email** — set `SENDER_EMAIL` with SES credentials, or
  `SENDER_EMAIL` + `OPENSEND_API_KEY` for Opensend.

Without any of these, magic-link requests return `503` and there is no way to sign
in. For a quick local trial without any email or OAuth setup, use the
development stack instead (`docker compose -f docker-compose.dev.yml up
--build`): in non-production mode the API returns the magic-link URL directly
in the sign-in response, and Mailhog (`http://localhost:8025`) captures any
outbound mail.

### OAuth redirect URLs

The API does **not** hard-code any callback host. It derives the OAuth
`redirect_uri` (and the post-login completion URL) from your configuration, in
this precedence order:

1. `PUBLIC_BASE_URL` — if set, used verbatim (trailing slash trimmed).
2. `NEXT_PUBLIC_APP_URL` — used if `PUBLIC_BASE_URL` is empty.
3. The incoming request's scheme + `Host` header — last-resort fallback.

So the callback you must register with each provider is
`<base>/api/auth/<provider>/callback`, where `<base>` is whatever the rule
above resolves to. For a self-host at `https://issues.example.com` set
`PUBLIC_BASE_URL=https://issues.example.com` and register:

| Provider | Authorized redirect URI to register |
| --- | --- |
| Google | `https://issues.example.com/api/auth/google/callback` |
| GitHub | `https://issues.example.com/api/auth/github/callback` |
| Discord | `https://issues.example.com/api/auth/discord/callback` |
| Microsoft | `https://issues.example.com/api/auth/microsoft/callback` |

**Troubleshooting:** if sign-in redirects you to the wrong host (e.g. a
different deployment's domain), the API answering your browser's `/api/*`
requests has a different `PUBLIC_BASE_URL`/`NEXT_PUBLIC_APP_URL` than you
expect. The Next.js web app proxies `/api/*` to `EXPONENTIAL_API_URL`; confirm
that points at *your* API, and that *that* API's `PUBLIC_BASE_URL` matches the
domain users actually reach the instance on.

## Required Environment

For Compose, set these in `.env` before exposing the instance:

| Variable | Purpose | Example |
| --- | --- | --- |
| `DB_PASSWORD` | Password for bundled Postgres. | Generate a real password for shared hosts. |
| `EXPONENTIAL_SESSION_SECRET` | HMAC secret for browser sessions. | `openssl rand -hex 32` |
| `EXPONENTIAL_METRICS_TOKEN` | Token for production RED metrics. The Compose stack runs the API with `EXPONENTIAL_API_ENVIRONMENT=production`, so `/metrics/red` returns `404` until this is set and sent via `X-Metrics-Token`. | `openssl rand -hex 32` |
| `EXPONENTIAL_PROVIDER_CREDENTIAL_ENCRYPTION_KEY` | AES-256-GCM key for third-party provider OAuth/API credentials stored in `provider_credential.encrypted_payload`. Required before connecting integrations; keep stable across deploys. | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | Browser-facing URL. | `https://issues.example.com` |
| `EXPONENTIAL_APP_URL` | Server-side canonical app URL. | Usually same as `NEXT_PUBLIC_APP_URL`. |

Existing plaintext `provider_credential.encrypted_payload` rows from older releases
are decrypted only by the API's shared credential helper and lazily re-written as
encrypted envelopes the next time the corresponding integration is used. Keep the
same encryption key until all active integrations have been exercised or
reconnected; rotating the key before that leaves existing encrypted credentials
undecryptable.

For local-only trials, `NEXT_PUBLIC_APP_URL` and `EXPONENTIAL_APP_URL` can stay
at `http://localhost:7015`.

> **Set the app URLs before exposing the instance.** No host is hard-coded — the
> API derives every user-facing absolute URL from `EXPONENTIAL_APP_URL` (falling
> back to `NEXT_PUBLIC_APP_URL`, then the request host). If both are unset the
> code falls back to `http://localhost:7015`, which then leaks into **outbound
> magic-link emails, Slack/Salesforce/Sentry webhook payload links, and OAuth
> redirect URIs** with no startup warning. `NEXT_PUBLIC_APP_URL` is a
> build-time (`NEXT_PUBLIC_`) value for the web app, so it must be present when
> you build the image, not just at runtime. Likewise set `EXPONENTIAL_API_URL`
> so the web app proxies `/api/*` to *your* API rather than the
> `http://localhost:7016/v1` default, and `EXPONENTIAL_INBOUND_DOMAIN` /
> `OPENSEND_BASE_URL` if you use inbound email or the Opensend mail provider —
> both default to Namuh-hosted values (`team.exponential.app`,
> `https://opensend.namuh.co`) when unset.

## Optional Features

| Feature | Variables | Behavior when omitted |
| --- | --- | --- |
| Google sign-in | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth is unavailable. |
| GitHub sign-in | `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | GitHub OAuth is unavailable. |
| Magic-link email (SMTP) | `SENDER_EMAIL`, `SMTP_HOST` (+ optional `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_TLS`) | Use this for any SMTP relay: Mailgun, Postmark, Gmail app password, your own mail server, or Mailhog in dev. |
| Magic-link email (Opensend) | `SENDER_EMAIL`, `OPENSEND_API_KEY` (+ optional `OPENSEND_BASE_URL`) | — |
| Magic-link email (SES) | `SENDER_EMAIL` with AWS credentials or instance/task role | — |
| Attachments | `AWS_REGION`, `S3_BUCKET`, AWS credentials or instance/task role; optional `S3_ENDPOINT` for S3-compatible storage | Attachment endpoints return service unavailable. |
| Slack integration | `AUTH_SLACK_ID`, `AUTH_SLACK_SECRET` | Slack installation is unavailable. |
| Inbound email | `INBOUND_EMAIL_WEBHOOK_SECRET`, `EXPONENTIAL_INBOUND_DOMAIN` | Inbound email routes cannot be used. |
| AI discussion summaries | `OPENAI_API_KEY`, `DISCUSSION_SUMMARY_PROVIDER=openai` | Summaries stay disabled/fallback-only. |
| Stripe webhooks | `STRIPE_WEBHOOK_SIGNING_SECRET` in API runtime, or ECS secret ARN | Billing webhook events are rejected. |

If none of the email providers are configured, production magic-link sign-in
returns 503 (unavailable). There is no fallback sender.

### Email provider selection

The provider is chosen in this order (first match wins):

1. `EMAIL_PROVIDER=smtp|ses|opensend` — explicit override.
2. `SMTP_HOST` set — generic SMTP relay (recommended for self-hosters).
3. `OPENSEND_API_KEY` set — Opensend managed relay.
4. `SENDER_EMAIL` set without the above — AWS SES.

**SMTP quick-start** (works with any relay; Mailhog in dev):

```bash
SENDER_EMAIL=no-reply@example.com
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USERNAME=postmaster@mg.example.com
SMTP_PASSWORD=your-mailgun-smtp-password
```

For implicit TLS on port 465, also set `SMTP_TLS=true`.

**Mailhog in the dev stack** — the dev Compose file already runs Mailhog on
port 1025. Point the API at it with:

```bash
SENDER_EMAIL=no-reply@example.com
SMTP_HOST=mailhog
SMTP_PORT=1025
```

No `SMTP_USERNAME`, `SMTP_PASSWORD`, or `SMTP_TLS` needed for Mailhog.

### Attachment Storage

Attachments use presigned object-storage URLs. Set `S3_BUCKET` for AWS S3, or
set both `S3_BUCKET` and `S3_ENDPOINT` for S3-compatible services such as MinIO,
Cloudflare R2, or Garage. When `S3_ENDPOINT` is present, the API signs path-style
URLs like `http://localhost:9000/bucket/key`.

For S3-compatible storage, `S3_ENDPOINT` must be reachable by the user's browser
because upload and download requests go directly to object storage. In Docker
Compose, `http://localhost:9000` works for a local MinIO trial even though the
API container itself talks to other services by container name.

The bundled Compose files include an optional MinIO profile. Add these values
to `.env` or export them in the shell before starting Compose:

```bash
S3_BUCKET=exponential-attachments
S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin

docker compose --profile minio up --build
```

MinIO's console is available at `http://localhost:9001` by default. The MinIO
service allows CORS for `NEXT_PUBLIC_APP_URL`, and the `minio-init` service
creates the bucket. For a non-local public install, set `NEXT_PUBLIC_APP_URL`
and `S3_ENDPOINT` to HTTPS origins that browsers can reach.

For R2, Garage, or an external MinIO deployment, create the bucket in that
service, configure equivalent CORS for `GET` and `PUT`, then set:

```bash
AWS_REGION=auto
S3_BUCKET=<bucket>
S3_ENDPOINT=https://<object-storage-origin>
AWS_ACCESS_KEY_ID=<access-key>
AWS_SECRET_ACCESS_KEY=<secret-key>
```

Local disk attachment storage is intentionally deferred. The current attachment
flow relies on presigned object-storage URLs; a disk driver would also need
authenticated file serving, cleanup, backup, and multi-instance semantics, so it
should be designed as a separate storage-driver change.

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

Image-based path (pull the new `latest` or a specific tag):

```bash
# Optional: pin a new release
# IMAGE_TAG=v1.2.3  # in .env

docker compose -f docker-compose.images.yml pull
docker compose -f docker-compose.images.yml up -d
```

Source-based path:

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

**Stripe is optional for ECS deployments.** `STRIPE_WEBHOOK_SIGNING_SECRET` and
`STRIPE_SECRET_KEY` are only needed when billing features are enabled (hosted
SaaS mode). Self-hosted deployments can omit both variables entirely.
`prepare-ecs-deploy-env.sh` skips the Stripe Secrets Manager entries when
neither the raw secret value nor an existing ARN is present. When Stripe is not
configured, the webhook route returns 400 and billing-related API calls are
unavailable, but all other API and UI functionality works normally.

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
tasks. When an ARN such as `DATABASE_URL_SECRET_ARN` or `REDIS_URL_SECRET_ARN`
already exists, re-run `SYNC_DEPLOY_SECRET_VALUES=true bash scripts/prepare-ecs-deploy-env.sh`
so Secrets Manager receives the new endpoint value, then deploy with
`RUN_PROD_SMOKE=true scripts/deploy-ecs.sh`.

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
     -c 'select count(*) from workspace;'
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

### HTTPS via ACM (recommended for production)

HTTPS is required for Google and GitHub OAuth redirect URIs and is strongly recommended
for all production deployments. `preflight.sh` can wire an HTTPS:443 ALB
listener and convert HTTP:80 to a permanent redirect when you supply an ACM
certificate ARN.

**1. Request an ACM certificate**

Open the [AWS Certificate Manager console](https://console.aws.amazon.com/acm/)
(or use the CLI) in the same region as your ALB and request a public
certificate for your domain:

```bash
aws acm request-certificate \
  --domain-name issues.example.com \
  --validation-method DNS \
  --region us-east-1
```

The command returns a `CertificateArn`. Copy it — you will need it in the next
step.

**2. Complete DNS validation**

ACM generates CNAME records that must be added to your DNS zone before the
certificate is issued. Look them up with:

```bash
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/... \
  --region us-east-1 \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
```

Add the CNAME records to your DNS provider and wait for the status to become
`ISSUED` (typically a few minutes):

```bash
aws acm wait certificate-validated \
  --certificate-arn arn:aws:acm:... \
  --region us-east-1
```

**Route 53 — automated DNS validation**

If your domain is hosted in Route 53 you can automate the validation step:

```bash
CERT_ARN=arn:aws:acm:us-east-1:123456789012:certificate/...
HOSTED_ZONE_ID=Z1234567890ABC   # your Route 53 hosted zone

# Retrieve the CNAME record from ACM and upsert it into Route 53.
CNAME=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" \
  --region us-east-1 \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord' \
  --output json)
NAME=$(echo "$CNAME" | jq -r '.Name')
VALUE=$(echo "$CNAME" | jq -r '.Value')

aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"UPSERT\",
      \"ResourceRecordSet\": {
        \"Name\": \"$NAME\",
        \"Type\": \"CNAME\",
        \"TTL\": 300,
        \"ResourceRecords\": [{\"Value\": \"$VALUE\"}]
      }
    }]
  }"

aws acm wait certificate-validated \
  --certificate-arn "$CERT_ARN" \
  --region us-east-1
echo "Certificate validated."
```

**3. Run preflight with the cert ARN**

Set `ACM_CERT_ARN` in `.env` (edit in place so the key is not duplicated if it
already exists) and re-run preflight:

```bash
# Set or update ACM_CERT_ARN in .env — grep+sed edits in place; appends if absent.
if grep -q '^ACM_CERT_ARN=' .env 2>/dev/null; then
  sed -i.bak 's|^ACM_CERT_ARN=.*|ACM_CERT_ARN=arn:aws:acm:us-east-1:123456789012:certificate/...|' .env && rm -f .env.bak
else
  echo "ACM_CERT_ARN=arn:aws:acm:us-east-1:123456789012:certificate/..." >> .env
fi
DB_PASSWORD=<password> bash scripts/preflight.sh
```

Preflight will:
- Create an HTTPS:443 listener with your certificate and the
  `ELBSecurityPolicy-TLS13-1-2-2021-06` security policy.
- Convert the HTTP:80 listener to a permanent (301) redirect to HTTPS.
- Route `/api/*` to the Go API on the HTTPS listener.

Re-runs are idempotent — existing listeners are detected and updated, not
duplicated.

**4. Point your domain at the ALB**

Create a DNS ALIAS (Route 53) or CNAME record pointing your domain to the ALB
DNS name written to `.env` as `ALB_DNS`:

```bash
grep ALB_DNS .env
# → ALB_DNS=exponential-alb-1234567890.us-east-1.elb.amazonaws.com
```

**5. Update app URLs**

Set the public HTTPS origin in `.env` before deploying:

```bash
NEXT_PUBLIC_APP_URL=https://issues.example.com
EXPONENTIAL_APP_URL=https://issues.example.com
PUBLIC_BASE_URL=https://issues.example.com
```

## Development Stack

For hot-reload development, use the dev stack:

```bash
docker compose -f docker-compose.dev.yml up --build
```

This uses bind mounts, development defaults, Mailhog, and Next.js dev mode. It
is not the recommended public self-hosting path.

## Known Limitations

- Attachment storage is S3/S3-compatible object-storage oriented; local disk
  attachment storage is intentionally deferred to a separate storage-driver
  design.
- Production magic-link sign-in requires at least one email provider (SMTP,
  Opensend, or SES). With no provider configured it returns 503.
- The pre-built GHCR images bundle the SDK/UI at the commit they were built
  from. If you modify the source, build your own images or use
  `docker-compose.yml` (source build path).
- ELv2 permits self-hosting and internal modification, but it does not permit
  offering exponential as a hosted service to third parties.
