.PHONY: check test test-e2e typecheck lint format fix all dev build clean cpd api-build
.PHONY: check-header test-header check-verbose test-verbose
.PHONY: dev-services dev-services-down

# Full validation: check + test
all: check test

# Static analysis: typecheck + lint/format
check: check-header typecheck lint api-build

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

# Auto-fix lint and format issues
fix:
	pnpm lint:fix

format:
	pnpm format

# Unit tests (Vitest) — only shows failures, summary on success
test: test-header
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

# Database migrations
db-generate:
	pnpm db:generate

db-migrate:
	pnpm db:migrate

db-push:
	pnpm db:push

# Clean build artifacts
clean:
	rm -rf apps/web/.next apps/web/dist node_modules/.cache apps/web/node_modules/.cache

# Start Postgres + Redis for local development (run alongside pnpm dev)
dev-services:
	pnpm --filter @exponential/web dev-services

# Stop development services
dev-services-down:
	docker compose -f docker-compose.dev.yml down
