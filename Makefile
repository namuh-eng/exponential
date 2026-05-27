.PHONY: check test test-e2e typecheck lint format fix all dev build clean cpd api-build api-test api-dockerfile ecs-task-definitions ecs-render deploy-scripts smoke-script openapi-coverage openapi-strict sqlc-generated web-api-empty web-sdk-usage
.PHONY: check-header test-header check-verbose test-verbose
.PHONY: dev-services dev-services-down deploy deploy-oauth-secrets

# Full validation: check + test
all: check test

# Static analysis: typecheck + lint/format
check: check-header typecheck lint api-build api-dockerfile ecs-task-definitions ecs-render deploy-scripts smoke-script openapi-coverage openapi-strict sqlc-generated web-api-empty web-sdk-usage

# TypeScript type checking
typecheck:
	@. ./hack/run_silent.sh && \
	run_silent "TypeCheck passed" "pnpm typecheck"

# Lint and format check (Biome)
lint:
	@. ./hack/run_silent.sh && \
	run_silent "Lint & Format passed" "pnpm lint"

# Go API build
api-build:
	@. ./hack/run_silent.sh && \
	run_silent "Go API build passed" "pnpm api:build"

# Go API tests
api-test:
	@. ./hack/run_silent.sh && \
	run_silent "Go API tests passed" "pnpm api:test"

# API Dockerfile production shape
api-dockerfile:
	@. ./hack/run_silent.sh && \
	run_silent "API Dockerfile uses distroless image" "bash infra/docker/api.Dockerfile.test.sh"

# ECS task definition shape
ecs-task-definitions:
	@. ./hack/run_silent.sh && \
	run_silent "ECS task definitions are split and CloudWatch-ready" "node scripts/check-ecs-task-definitions.mjs"

# ECS task rendering
ecs-render:
	@. ./hack/run_silent.sh && \
	run_silent "ECS task definition rendering works" "node scripts/render-ecs-task-definitions.test.mjs"

# Deploy script syntax
deploy-scripts:
	@. ./hack/run_silent.sh && \
	run_silent "Deploy scripts are syntactically valid" "sh -n scripts/deploy-ecs.sh && sh -n scripts/configure-ecs-autoscaling.sh && node scripts/check-deploy-scripts.mjs"

# Production smoke script shape
smoke-script:
	@. ./hack/run_silent.sh && \
	run_silent "Production smoke script covers web/api/metrics" "sh -n scripts/smoke-prod.sh && node scripts/check-smoke-script.mjs"

# OpenAPI coverage
openapi-coverage:
	@. ./hack/run_silent.sh && \
	run_silent "OpenAPI coverage passed" "node scripts/check-openapi-coverage.mjs"

# Generated Go OpenAPI strict server stubs
openapi-strict:
	@. ./hack/run_silent.sh && \
	run_silent "OpenAPI strict-server stubs present" "node scripts/check-go-openapi-generated.mjs"

# sqlc generated query coverage
sqlc-generated:
	@. ./hack/run_silent.sh && \
	run_silent "sqlc generated queries present" "node scripts/check-sqlc-generated.mjs"

# Ensure Next.js remains UI-only.
web-api-empty:
	@. ./hack/run_silent.sh && \
	run_silent "Web API route directory is empty" "pnpm web-api-empty"

# Ensure migrated web runtime slices consume the generated SDK instead of
# hard-coded endpoint fetches.
web-sdk-usage:
	@. ./hack/run_silent.sh && \
	run_silent "Web runtime SDK usage passed" "node scripts/check-web-sdk-usage.mjs"

# Auto-fix lint and format issues
fix:
	pnpm lint:fix

format:
	pnpm format

# Unit tests (Vitest) — only shows failures, summary on success
test: test-header api-test
	@. ./hack/run_silent.sh && \
	run_silent_with_test_count "Unit Tests passed" "TZ=Asia/Seoul pnpm test" "vitest"

# E2E tests (Playwright — requires dev server running)
test-e2e:
	@. ./hack/run_silent.sh && \
	run_silent_with_test_count "E2E Tests passed" "pnpm test:e2e" "playwright"

# Headers
check-header:
	@sh -n ./hack/run_silent.sh || (echo "Shell script syntax error" && exit 1)
	@. ./hack/run_silent.sh && print_main_header "Running Checks"

test-header:
	@sh -n ./hack/run_silent.sh || (echo "Shell script syntax error" && exit 1)
	@. ./hack/run_silent.sh && print_main_header "Running Tests"

# Verbose versions (show full output)
check-verbose:
	@VERBOSE=1 $(MAKE) check

test-verbose:
	@VERBOSE=1 $(MAKE) test

# Copy-paste detection (jscpd)
cpd:
	pnpm cpd

# Dev server
dev:
	pnpm dev

# Production build
build:
	pnpm build

# Clean build artifacts
clean:
	rm -rf apps/web/.next apps/web/dist node_modules/.cache apps/web/node_modules/.cache

# Start Postgres + Redis for local development (run alongside pnpm dev)
dev-services:
	pnpm --filter @exponential/web dev-services

# Stop development services
dev-services-down:
	docker compose -f docker-compose.dev.yml down

# Build, push, and roll out ECS services (api + web). Tags images with the
# current commit SHA and runs the prod smoke test at the end.
deploy:
	RUN_PROD_SMOKE=true IMAGE_TAG=$$(git rev-parse --short HEAD) bash scripts/deploy-ecs.sh

# Push AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET from .env into Secrets Manager and
# force-redeploy the API service so new tasks pick up the values.
deploy-oauth-secrets:
	bash scripts/sync-google-oauth-secrets.sh
