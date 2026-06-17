# GitHub Actions — workflows

## release.yml — versioned npm releases

Triggers on semver tags (`v*.*.*`). Creates a GitHub Release with changelog
notes and publishes `@namuh-eng/expn-sdk` and `@namuh-eng/expn-cli` to npm.

### Cutting a release

```sh
# 1. Bump version in both package.json files and commit the bump to main:
node -e "const f='packages/sdk/package.json', p=JSON.parse(require('fs').readFileSync(f)); \
  p.version='0.2.0'; require('fs').writeFileSync(f, JSON.stringify(p,null,2)+'\n')"
node -e "const f='apps/cli/package.json', p=JSON.parse(require('fs').readFileSync(f)); \
  p.version='0.2.0'; require('fs').writeFileSync(f, JSON.stringify(p,null,2)+'\n')"
git add packages/sdk/package.json apps/cli/package.json
git commit -m "chore: bump version to 0.2.0"
git push

# 2. Tag and push (triggers release.yml):
bash scripts/tag-release.sh 0.2.0
```

### Required repository secret

`NPM_TOKEN` — an npm automation token with publish rights for `@namuh-eng`.
Set it under **Settings → Secrets and variables → Actions → Secrets**.

### Pre-release tags

Tags with a hyphen suffix (e.g. `v1.0.0-beta.1`) are published to npm and
marked as a GitHub pre-release automatically.

---

## publish-cli.yml — manual / emergency publish

Manual workflow with an explicit dry-run toggle. Use this for out-of-band
publishes or to verify packaging without releasing. For normal releases, use
`scripts/tag-release.sh` and `release.yml` instead.

---

# GitHub Actions — deploy

`deploy.yml` ships `exponential` to ECS Fargate. Push-to-`main` deploys use the
Mac mini self-hosted runner, and manual runs can use a GitHub-hosted OIDC
fallback. Runner-down recovery lives in
[docs/deploy-runner-recovery.md](../../docs/deploy-runner-recovery.md).

Triggers:

- **Push to `main`** affecting `apps/**`, `packages/**`, `infra/**`, or any of
  the deploy scripts → automatic deploy
- **Manual `workflow_dispatch`** with a deploy lane selector and optional
  toggles to skip smoke / autoscaling

The runner uses the host's AWS credentials (same as a local laptop deploy
would). The GitHub-hosted fallback assumes `AWS_DEPLOY_ROLE_ARN` through OIDC
only when selected manually.

## One-time setup

### 1. Register the runner label

On the Mac mini, add `exponential-deploy` to the existing runner's labels.
If the runner config lives at
`~/actions-runner/.runner` (or wherever you have it for opensend /
forever-agent), edit the labels and restart the launchd service. For a
brand-new runner: when running `./config.sh`, set
`--labels self-hosted,exponential-deploy`.

### 2. Pre-stage Docker config

The deploy step assumes `~/.docker-actions/config.json` exists with an empty
`auths` object (same as the other repos):

```sh
mkdir -p ~/.docker-actions
printf '{"auths":{}}\n' > ~/.docker-actions/config.json
```

### 3. Populate GitHub repository variables

These are **infrastructure identifiers**, not secrets. Set them under
**Settings → Secrets and variables → Actions → Variables** (the "Variables"
tab, *not* Secrets). They're the same values currently in `.env` after
running `scripts/prepare-ecs-deploy-env.sh`.

| Variable                          | Notes                                                                |
|-----------------------------------|----------------------------------------------------------------------|
| `AWS_REGION`                      | Optional, defaults to `us-east-1`                                    |
| `APP_NAME`                        | Optional, defaults to `exponential`                                  |
| `ECS_EXECUTION_ROLE_ARN`          | Created by `prepare-ecs-deploy-env.sh`                               |
| `ECS_TASK_ROLE_ARN`               | Created by `prepare-ecs-deploy-env.sh`                               |
| `DATABASE_URL_SECRET_ARN`         | Secrets Manager ARN                                                  |
| `REDIS_URL_SECRET_ARN`            | Secrets Manager ARN                                                  |
| `SESSION_SECRET_SECRET_ARN`       | Secrets Manager ARN                                                  |
| `GOOGLE_CLIENT_ID_SECRET_ARN`     | Secrets Manager ARN                                                  |
| `GOOGLE_CLIENT_SECRET_SECRET_ARN` | Secrets Manager ARN                                                  |
| `METRICS_TOKEN_SECRET_ARN`        | Secrets Manager ARN for the RED metrics token                        |
| `STRIPE_WEBHOOK_SIGNING_SECRET_SECRET_ARN` | Secrets Manager ARN for Stripe webhook signatures           |
| `PUBLIC_BASE_URL`                 | `https://<your-domain>` (or `http://<alb-dns>`)                      |
| `PRIV_SUBNET_A`, `PRIV_SUBNET_B`  | Private subnet IDs                                                   |
| `APP_SG`                          | App security group ID                                                |
| `ALB_SG`                          | ALB security group ID                                                |
| `API_TG_ARN`                      | API target-group ARN                                                 |
| `WEB_TG_ARN`                      | Web target-group ARN                                                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | Optional                                                             |
| `EXPONENTIAL_TRUSTED_PROXIES`     | Optional                                                             |
| `AWS_DEPLOY_ROLE_ARN`             | Required only for the manual `github-hosted-oidc` fallback lane      |

If the runner precheck cannot read repository self-hosted runner status with
the default workflow token, set Actions secret `GH_RUNNER_STATUS_TOKEN` to a
fine-grained token with repository **Administration: read** permission.

Copy values straight from your local `.env`. Example one-liner to read them
out of `.env` for paste-in (run on your laptop):

```sh
for k in AWS_REGION APP_NAME ECS_EXECUTION_ROLE_ARN ECS_TASK_ROLE_ARN \
         DATABASE_URL_SECRET_ARN REDIS_URL_SECRET_ARN \
         SESSION_SECRET_SECRET_ARN METRICS_TOKEN_SECRET_ARN \
         STRIPE_WEBHOOK_SIGNING_SECRET_SECRET_ARN \
         GOOGLE_CLIENT_ID_SECRET_ARN GOOGLE_CLIENT_SECRET_SECRET_ARN \
         PUBLIC_BASE_URL PRIV_SUBNET_A PRIV_SUBNET_B APP_SG ALB_SG \
         API_TG_ARN WEB_TG_ARN OTEL_EXPORTER_OTLP_ENDPOINT \
         EXPONENTIAL_TRUSTED_PROXIES; do
  v=$(grep "^${k}=" .env 2>/dev/null | head -n1 | cut -d= -f2-)
  printf '%-40s %s\n' "$k" "${v:-<unset>}"
done
```

Or programmatically via `gh`:

```sh
gh variable set AWS_REGION --body "us-east-1"
gh variable set ECS_EXECUTION_ROLE_ARN --body "arn:aws:iam::...:role/exponential-ecs-execution-role"
# ...etc
```

`scripts/prepare-ecs-deploy-env.sh` reuses existing `DATABASE_URL_SECRET_ARN`
and `REDIS_URL_SECRET_ARN` values by default so local development URLs are not
mirrored into production accidentally. Set `SYNC_DEPLOY_SECRET_VALUES=true`
only when you intentionally want to overwrite the backing Secrets Manager
values from the current shell environment.

### 4. First deploy

Manual trigger from the Actions tab → "Deploy" → "Run workflow". Keep
**Deploy lane** set to `self-hosted` for the normal path. After it succeeds,
every push to `main` that touches a path listed at the top of `deploy.yml` will
auto-deploy.

If the self-hosted runner is offline, select **Deploy lane** =
`github-hosted-oidc`. That fallback uses GitHub-hosted Linux, assumes
`AWS_DEPLOY_ROLE_ARN`, and runs the same `scripts/deploy-ecs.sh` path. See the
runner-down procedure in
[docs/deploy-runner-recovery.md](../../docs/deploy-runner-recovery.md).

## Local break-glass

`make deploy` still works exactly as before — directly against the laptop's
AWS credentials. Use it when:

- The runner host is offline
- You need to deploy a non-`main` branch (be careful)
- You're debugging the deploy script itself

The 1Password / `.env` setup feeds the local path; the workflow does not
read `.env` at all (everything comes from `vars.*`).
