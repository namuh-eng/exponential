---
date: 2026-05-31T18:19:37+0900
git_commit: a15ec82bb6d7342ae9cea9a30229bc7b16ab16a1
branch: main
issue: PR #553
tests: passing with one unrelated e2e failure noted
---

# Handoff: PR #553 — production security hardening and deploy

## What I was doing
Security-hardening `exponential` after finding that `.env.prod.backup` contained production secrets. The risky backup file was deleted locally, env files were hardened out of Docker build context, high-risk security fixes were implemented, pushed, and deployed to production ECS.

PR: https://github.com/namuh-eng/exponential/pull/553

## Current State
- Branch: `main` now contains the merged security hardening via merge commit `b26f6a4`. Source branch was `codex/fix-production-session-secret`.
- Production deploy: completed manually from this branch using image tag `a15ec82`.
  - API: `exponential-api:36`, running `699486076867.dkr.ecr.us-east-1.amazonaws.com/exponential-api:a15ec82`.
  - Web: `exponential-web:40`, running `699486076867.dkr.ecr.us-east-1.amazonaws.com/exponential-web:a15ec82`.
  - ECS rollout state: `COMPLETED`, desired/running `1/1` for both services.
- Prod smoke passed: web root, `/api/healthz`, and token-authenticated `/api/metrics/red`.
- Production metrics are protected now: unauthenticated `/api/metrics/red` returns `404`, token-authenticated returns `200`.
- Security headers are live on `https://exponential.namuh.co/`.
- `.env.prod.backup` is absent locally. `.env*` and `**/.env*` are ignored for Docker context; `.env.example` remains allowed.
- Uncommitted/untracked local file: `landing.html` only; unrelated, do not commit unless the owner asks.

## Test State
Passing:
- `make check`
- `make test`
- `cd apps/api && go test ./...`
- `pnpm audit --audit-level=moderate` -> no known vulnerabilities
- `govulncheck ./...` -> no vulnerabilities found
- Targeted E2E: `pnpm --filter @exponential/web test:e2e -- tests/e2e/workspace-auth-methods.spec.ts tests/e2e/settings-api-oauth.spec.ts`

Full E2E caveat:
- `make test-e2e` ran the real suite: 140 passed, 1 flaky passed on retry, 1 failed.
- Failing test: `apps/web/tests/e2e/workspace-ai-settings.spec.ts` expected self-demotion to return 200, but API correctly returned 400 for "Use your account settings to change your own access". This appears unrelated to this security pass.
- Flaky retry-pass: `tests/e2e/views.spec.ts` had `ERR_EMPTY_RESPONSE` once, then passed on retry.

## Recent Commits
- `a15ec82 fix: require token for production metrics smoke`
- `1d12829 fix: harden production security controls`
- `afd86b9 fix: reject missing rendered ecs secrets`
- `85bdd41 fix: exclude env files from docker builds`
- `4f1b888 fix: route web api calls internally`

## Key files touched
- `.dockerignore` — excludes `.env*` and `**/.env*` from Docker contexts while allowing examples.
- `apps/api/internal/auth/auth.go:33` — principal now carries PAT scopes.
- `apps/api/internal/auth/auth.go:97` and `apps/api/internal/auth/auth.go:138` — PAT scope enforcement for read/write methods.
- `apps/api/internal/auth/auth.go:162` — CSRF fails closed in production when allowed origins are not configured.
- `apps/api/internal/auth/auth.go:682` — PAT scopes are loaded from `personal_access_token.scopes`, defaulting legacy empty PAT scopes to read-only.
- `apps/api/internal/tokens/handler.go:82` — unsupported PAT scopes are rejected instead of silently granting arbitrary scope strings.
- `apps/api/internal/sanitizehtml/html.go:18` — central rich-text sanitizer using bluemonday.
- `apps/api/internal/issues/handler.go:652` and `apps/api/internal/issues/handler.go:755` — issue descriptions sanitized on create/update.
- `apps/api/internal/inbound/handler.go:212` and `apps/api/internal/inbound/handler.go:214` — inbound email HTML/plaintext descriptions sanitized before issue creation.
- `apps/api/internal/authproviders/firstparty.go:58` and `apps/api/internal/authproviders/firstparty.go:161` — server-side workspace auth-method policy enforced for Google and magic link starts.
- `apps/api/internal/authproviders/oauth.go:50` — invalid OAuth redirect URI returns JSON 400 instead of redirecting to attacker-controlled URLs.
- `apps/api/internal/workspaces/api_current.go:461` and `apps/api/internal/workspaces/api_current.go:482` — server-side OAuth redirect/scope validation for workspace OAuth app create/update.
- `apps/api/internal/http/router.go:72` and `apps/api/internal/http/router.go:153` — RED metrics endpoint requires `EXPONENTIAL_METRICS_TOKEN` in production.
- `apps/web/next.config.js:27` — security headers/CSP configured.
- `infra/ecs/api-task-definition.json:69` — API task receives `EXPONENTIAL_METRICS_TOKEN` from Secrets Manager.
- `scripts/smoke-prod.sh:8` and `scripts/smoke-prod.sh:46` — production smoke reads the metrics token and sends `X-Metrics-Token`.

## Learnings
- `.env.prod.backup` was ignored by git and not found in git history, but it was still a Docker build-context risk until `.dockerignore` was hardened. Final images checked earlier did not contain `.env*`, but excluding all `.env*` from context is the durable fix.
- PR #553 was merged to `main` as merge commit `b26f6a4`; this handoff file is intentionally force-added under `.handoffs/` despite the directory normally being gitignored.
- Production deploy initially required a metrics token because the new metrics guard made `/api/metrics/red` private. A new AWS Secrets Manager secret was created: `arn:aws:secretsmanager:us-east-1:699486076867:secret:exponential/metrics-token-1cAwo4`, and GitHub repo variable `METRICS_TOKEN_SECRET_ARN` was set to that ARN.
- A manual GitHub Actions deploy run was started on the branch and then cancelled because it stayed queued/in-progress without jobs; local break-glass deploy succeeded.
- Rotate secrets after code deploy, not before, so the deployed code can consume the new protected secret paths and metrics smoke can authenticate.

## Blockers
- No current deployment blocker. Production is running the hardened images.
- Remaining security hygiene work is secret rotation by the human/operator.
- Full E2E has one unrelated failure in workspace AI settings that should be fixed separately before treating the whole suite as green.

## Next steps
1. Rotate any real secrets that were in `.env.prod.backup`: session secret, DB password/URL, Redis auth if present, Google OAuth client secret, inbound/webhook secrets, and any copied PAT/API tokens.
2. After each secret rotation, force ECS service redeploy so tasks reload Secrets Manager values:
   `aws ecs update-service --cluster exponential-cluster --service exponential-api --force-new-deployment --region us-east-1 && aws ecs update-service --cluster exponential-cluster --service exponential-web --force-new-deployment --region us-east-1`
3. Re-run production smoke after rotation.
4. Separately fix or update `workspace-ai-settings.spec.ts` self-demotion expectation/API behavior, then re-run full `make test-e2e`.
