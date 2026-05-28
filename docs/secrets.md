# Secrets — 1Password Workflow

Secrets for `exponential` live in the 1Password vault **`Exponential`** on
`namuhinc.1password.com` (vault id `vbj3bair72fivxrirawf4rdddm`).

The repo ships a single reference file, `.env.1password`, that maps env-var
names to `op://` references. At runtime, `op run` resolves those references
and exposes them as real env vars to the wrapped command. The reference file
contains no secret values and is committed.

```
.env.1password   →   op run --env-file=.env.1password -- <cmd>   →   <cmd> sees real values
```

## Vault contents

| Item            | Field          | Env var                          |
|-----------------|----------------|----------------------------------|
| `database`      | `url`          | `DATABASE_URL`                   |
| `redis`         | `url`          | `REDIS_URL`                      |
| `session`       | `secret`       | `EXPONENTIAL_SESSION_SECRET`     |
| `google-oauth`  | `id`           | `AUTH_GOOGLE_ID`                 |
| `google-oauth`  | `secret`       | `AUTH_GOOGLE_SECRET`             |
| `aws`           | `s3-bucket`    | `S3_BUCKET`                      |
| `aws`           | `sender-email` | `SENDER_EMAIL`                   |

Non-secret config (`AWS_REGION`, `*_APP_URL`, etc.) is kept as literal values
in `.env.1password` directly — there's no point putting them in 1Password.

## Local development

One-time setup:

```sh
brew install 1password-cli                       # if not already installed
op signin --account namuhinc.1password.com       # opens desktop app for auth
make op-doctor                                   # verify every reference resolves
```

Day-to-day:

```sh
make dev-op       # = op run --env-file=.env.1password -- pnpm dev
make build-op     # = op run --env-file=.env.1password -- pnpm build
make start-op     # = op run --env-file=.env.1password -- pnpm start

# Ad-hoc:
op run --env-file=.env.1password -- <anything>
```

The legacy `.env` workflow still works (`make dev` reads `.env`). 1Password is
opt-in via the `*-op` targets.

## Pushing values into 1Password (first-time / migration)

If you already have a populated local `.env`, push it up once:

```sh
make op-bootstrap
```

That runs `scripts/op-bootstrap.sh`, which reads `.env` and writes each value
to the matching item/field with `op item edit`. The script never prints
secrets and never modifies your shell environment beyond its own subshell.

To edit a single secret later:

```sh
op item edit database --vault=Exponential url='postgresql://...'
op item edit google-oauth --vault=Exponential secret='...'
```

Or in the desktop app.

## CI / deployment — service account

For GitHub Actions and any other non-interactive context, create a 1Password
service account scoped read-only to the `Exponential` vault.

### Create the service account (one-time, by an admin)

```sh
op service-account create "exponential-ci" \
  --expires-in 365d \
  --vault Exponential:read_items
```

The command prints a token starting with `ops_`. Treat it as a secret. Add it
to GitHub Actions as repository secret `OP_SERVICE_ACCOUNT_TOKEN`.

### Use it in a workflow

```yaml
# .github/workflows/<example>.yml
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: 1password/install-cli-action@v2
      - run: op run --env-file=.env.1password -- pnpm build
```

The service account token is the only difference vs. local — `op run` picks
it up from the env automatically and never prompts.

### Rotate

```sh
op service-account revoke exponential-ci
op service-account create "exponential-ci" --expires-in 365d --vault Exponential:read_items
# update OP_SERVICE_ACCOUNT_TOKEN in GitHub secrets
```

## Relationship to AWS Secrets Manager

Production tasks running in ECS continue to read secrets from AWS Secrets
Manager via the ARNs declared in the rendered ECS task definition (see
`scripts/render-ecs-task-definitions.mjs` and `scripts/prepare-ecs-deploy-env.sh`).
1Password is the **source of truth for humans and CI**. The deploy pipeline
can mirror values from 1Password into Secrets Manager when it runs.

Today, `scripts/sync-google-oauth-secrets.sh` pushes `.env`-sourced values
into Secrets Manager. To make that pipeline 1Password-native, prefix the
existing target with `op run`:

```make
deploy-oauth-secrets:
	$(OP_RUN) bash scripts/sync-google-oauth-secrets.sh
```

(Not changed by default — opt in when you're ready to retire `.env` as a
deploy-time source.)

## Troubleshooting

- **`op signin` hangs** — make sure the 1Password desktop app is running and
  CLI integration is enabled in *Settings → Developer → Integrate with 1Password CLI*.
- **`op-doctor` shows unresolved references** — run `make op-bootstrap` (or
  `op item edit` per-field) to populate empty fields.
- **`op run` resolves to empty string** — the field exists but is empty.
  `op-doctor` catches this; `op item get <item> --vault=Exponential --fields=<field>` confirms.
- **Service-account token rejected** — tokens expire. Run
  `op service-account ratelimit` to confirm it's the token, not rate limiting.
