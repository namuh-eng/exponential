# Documentation Map

This directory contains operator, deployment, and architecture-adjacent docs for
exponential. Current-state docs live here and in the root README files; older
planning docs are kept for decision history.

## Start Here

- [../README.md](../README.md) - product overview, screenshots, quick start,
  architecture table, and command summary.
- [../CONTRIBUTING.md](../CONTRIBUTING.md) - contributor workflow,
  architecture rules, verification gates, PR expectations, and troubleshooting.
- [../AGENTS.md](../AGENTS.md) and [../CLAUDE.md](../CLAUDE.md) - coding-agent
  guardrails and current repo boundaries.
- [self-hosting.md](self-hosting.md) - Docker Compose, environment variables,
  bind addresses, health checks, reverse proxy, backups, upgrades, and ECS path.

## Headless Clients

- [cli.md](cli.md) - `expn` CLI installation, auth, output contract, commands,
  config, and troubleshooting.
- [mcp.md](mcp.md) - local read-only stdio MCP server scope, tools, client
  config, smoke tests, and follow-up boundaries.
- [cli-publishing.md](cli-publishing.md) - maintainer flow for publishing the
  SDK and CLI packages.
- [zapier.md](zapier.md) - Zapier Platform app setup, OAuth scopes, triggers,
  actions, webhook signing, and attachment upload behavior.

## Secrets and Operations

- [secrets.md](secrets.md) - 1Password workflow, CI service accounts, AWS
  Secrets Manager relationship, email provider selection, and Stripe webhook
  secret handling.

## Historical Context

- [refactor-plan.md](refactor-plan.md) - historical implementation plan for the
  migration from a Next.js monolith to the current Go API + Next.js UI split.
  Do not use its "Current state" section as present-day repo truth.

## Package-Level Docs

- [../apps/api/README.md](../apps/api/README.md) - Go API contract workflow,
  migrations, auth/error conventions, and focused checks.
- [../apps/web/README.md](../apps/web/README.md) - Next.js web app boundaries,
  local dev, tests, and UI conventions.
- [../apps/cli/README.md](../apps/cli/README.md) - CLI package quick reference.
- [../apps/mcp/README.md](../apps/mcp/README.md) - stdio MCP runtime package.
- [../packages/sdk/README.md](../packages/sdk/README.md) - generated SDK usage,
  regeneration, and validation.
