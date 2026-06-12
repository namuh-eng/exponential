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
- Optional SES or Opensend credentials for production email.

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
$EDITOR .env

docker compose up --build
```

The default Compose stack publishes the web app to all interfaces. Postgres,
Redis, and the direct API port bind to `127.0.0.1` by default for local admin
and smoke checks without public exposure.

## Required Environment

For Compose, set these in `.env` before exposing the instance:

| Variable | Purpose | Example |
| --- | --- | --- |
| `DB_PASSWORD` | Password for bundled Postgres. | Generate a real password for shared hosts. |
| `EXPONENTIAL_SESSION_SECRET` | HMAC secret for browser sessions. | `openssl rand -hex 32` |
| `EXPONENTIAL_METRICS_TOKEN` | Token for production RED metrics. | `openssl rand -hex 32` |
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

For ECS web-to-API server requests, prefer `WEB_INTERNAL_API_URL` pointing at
the internal ALB/API route so server-side auth/session checks do not hairpin
through a public CDN or proxy hostname.

### HTTPS via ACM (recommended for production)

HTTPS is required for Google OAuth redirect URIs and is strongly recommended
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

- Attachment storage is S3-oriented; local disk attachment storage is not
  implemented.
- Production email requires SES or Opensend configuration.
- The pre-built GHCR images bundle the SDK/UI at the commit they were built
  from. If you modify the source, build your own images or use
  `docker-compose.yml` (source build path).
- ELv2 permits self-hosting and internal modification, but it does not permit
  offering exponential as a hosted service to third parties.
