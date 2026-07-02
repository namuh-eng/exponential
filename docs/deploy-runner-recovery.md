# Deploy Runner Recovery

Use this runbook when the GitHub Actions deploy queue is blocked because no
online self-hosted runner has both `self-hosted` and `exponential-deploy`
labels.

## First check

1. Open the failed or queued Deploy workflow run.
2. If `Check self-hosted deploy runner` failed, read its message. It is meant
   to fail before the self-hosted deploy job is scheduled.
3. Confirm whether the self-hosted deploy runner is online:

```sh
gh api repos/namuh-eng/exponential/actions/runners \
  --jq '.runners[] | {name, status, labels: [.labels[].name]}'
```

## Break-glass from a credentialed laptop

Use this path when production needs a deploy now and the self-hosted runner cannot
be restored quickly.

Prerequisites:

- AWS CLI is authenticated to the production account.
- Docker is running and can build Linux images for the cluster's CPU architecture (arm64 by default).
- Node and pnpm are available through the repo toolchain.
- `.env` contains the ECS, target-group, subnet, security-group, public URL,
  and Secrets Manager ARN values created by `scripts/prepare-ecs-deploy-env.sh`.
- The current branch and commit are the exact revision you intend to deploy.

Deploy:

```sh
git fetch origin
git status --short --branch
make deploy
```

`make deploy` runs:

```sh
RUN_PROD_SMOKE=true IMAGE_TAG=$(git rev-parse --short HEAD) bash scripts/deploy-ecs.sh
```

If you need to run the command directly, keep `RUN_PROD_SMOKE=true` unless a
maintainer explicitly accepts the risk. After the script finishes, verify the
web, API, and metrics checks printed by `scripts/smoke-prod.sh`.

## Manual cloud fallback

Decision: implement now. Push-to-`main` deploys stay on the self-hosted Mac mini
runner, but maintainers can run a GitHub-hosted fallback lane per run through
GitHub OIDC.

One-time repository setup:

- Set Actions variable `AWS_DEPLOY_ROLE_ARN` to an IAM role trusted by this
  repository's GitHub OIDC provider.
- Keep the existing deploy variables from `.github/workflows/README.md`
  populated; the fallback lane reuses them.
- Set secret `GH_RUNNER_STATUS_TOKEN` if the default `GITHUB_TOKEN` cannot
  read repository self-hosted runners in this org. Use a fine-grained token
  with repository **Administration: read** permission; the precheck uses it
  only for runner status.

Per-run fallback:

1. Go to **Actions -> Deploy -> Run workflow**.
2. Set **Deploy lane** to `github-hosted-oidc`.
3. Leave smoke and autoscaling enabled unless you are intentionally bypassing
   one for an incident.
4. Run the workflow. The job assumes `AWS_DEPLOY_ROLE_ARN` through OIDC and
   executes `scripts/deploy-ecs.sh`.

The fallback lane grants `id-token: write` only on the GitHub-hosted OIDC job.
The self-hosted lane continues to use the runner host's AWS credentials.

## Restore or re-register the self-hosted runner

If the existing self-hosted runner is present but offline:

1. Log in to the host.
2. Restart the runner launchd service for the Actions runner.
3. Confirm the runner appears online in GitHub with labels `self-hosted` and
   `exponential-deploy`.

If the runner must be recreated, register it from GitHub:

1. Open **Settings -> Actions -> Runners -> New self-hosted runner**.
2. Follow GitHub's runner setup steps on the runner host. The cluster runs arm64, so an arm64 runner builds images natively (fastest); an x86_64 runner works too but cross-builds arm64 under emulation.
3. Run `./config.sh` with:

```sh
./config.sh --labels self-hosted,exponential-deploy
```

4. Install or restart the launchd service using GitHub's generated commands.
5. Re-run the Deploy workflow with **Deploy lane** set to `self-hosted`.
