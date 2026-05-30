# GitHub Actions — deploy

`deploy.yml` ships `exponential` to ECS Fargate via the Mac mini self-hosted
runner. Triggers:

- **Push to `main`** affecting `apps/**`, `packages/**`, `infra/**`, or any of
  the deploy scripts → automatic deploy
- **Manual `workflow_dispatch`** with optional toggles to skip smoke /
  autoscaling

The runner uses the host's AWS credentials (same as a local laptop deploy
would). No OIDC needed because deploys run on hardware you own.

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
| `PUBLIC_BASE_URL`                 | `https://<your-domain>` (or `http://<alb-dns>`)                      |
| `PRIV_SUBNET_A`, `PRIV_SUBNET_B`  | Private subnet IDs                                                   |
| `APP_SG`                          | App security group ID                                                |
| `ALB_SG`                          | ALB security group ID                                                |
| `API_TG_ARN`                      | API target-group ARN                                                 |
| `WEB_TG_ARN`                      | Web target-group ARN                                                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | Optional                                                             |
| `EXPONENTIAL_TRUSTED_PROXIES`     | Optional                                                             |

Copy values straight from your local `.env`. Example one-liner to read them
out of `.env` for paste-in (run on your laptop):

```sh
for k in AWS_REGION APP_NAME ECS_EXECUTION_ROLE_ARN ECS_TASK_ROLE_ARN \
         DATABASE_URL_SECRET_ARN REDIS_URL_SECRET_ARN \
         SESSION_SECRET_SECRET_ARN METRICS_TOKEN_SECRET_ARN \
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

### 4. First deploy

Manual trigger from the Actions tab → "Deploy" → "Run workflow". After it
succeeds, every push to `main` that touches a path listed at the top of
`deploy.yml` will auto-deploy.

## Local break-glass

`make deploy` still works exactly as before — directly against the laptop's
AWS credentials. Use it when:

- The runner host is offline
- You need to deploy a non-`main` branch (be careful)
- You're debugging the deploy script itself

The 1Password / `.env` setup feeds the local path; the workflow does not
read `.env` at all (everything comes from `vars.*`).
