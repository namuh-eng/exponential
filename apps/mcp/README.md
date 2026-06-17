# exponential MCP Runtime

`apps/mcp` is the local stdio runtime package for Exponential MCP v0. It exposes
the `exponential-mcp` binary and delegates tool implementation to
`packages/mcp-server`.

MCP v0 is intentionally local and read-only. It uses the generated SDK and the
same personal access token boundary as the CLI.

## Run Locally

From the repo root:

```bash
EXPONENTIAL_TOKEN=pat_your_token \
EXPONENTIAL_API_URL=http://localhost:7016/v1 \
pnpm --filter @exponential/mcp exec exponential-mcp
```

Configure MCP clients to spawn this stdio command. Do not commit PAT values into
client config files.

## Package Shape

- Runtime package: `apps/mcp`
- Server/tool implementation: `packages/mcp-server`
- Public docs: [../../docs/mcp.md](../../docs/mcp.md)
- SDK dependency: `@namuh-eng/expn-sdk`

## Validation

```bash
pnpm --filter @exponential/mcp typecheck
pnpm --filter @exponential/mcp-server typecheck
pnpm --filter @exponential/mcp-server test
```

Repo-level `make check` typechecks the workspace and validates the broader API
contract.
