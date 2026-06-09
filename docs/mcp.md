# Exponential MCP v0

Exponential MCP v0 is a local stdio server for AI clients that need safe,
read-only access to Exponential issues, projects, and cycles.

The reusable server package is `packages/mcp-server`. The stdio runtime is
`apps/mcp` and exposes the `exponential-mcp` binary.

## Scope

MCP v0 is read-only and local-only.

Registered tools:

- `search_issues`
- `get_issue`
- `list_my_issues`
- `list_projects`
- `get_project`
- `list_team_cycles`

Not included in v0:

- write tools such as `create_issue` or `update_issue`
- issue comment listing, because the OpenAPI/SDK contract does not expose a
  comment-read endpoint yet
- HTTP transport
- OAuth setup
- public or hosted remote MCP
- direct database access

All tools call the generated TypeScript SDK against the Go API and inherit the
same personal access token authorization boundary as the CLI.

## Run locally

From a source checkout:

```bash
pnpm install
EXPONENTIAL_TOKEN=pat_your_token \
EXPONENTIAL_API_URL=http://localhost:7016/v1 \
pnpm --filter @exponential/mcp exec exponential-mcp
```

`EXPONENTIAL_API_URL` defaults to the SDK default when omitted. For local
development and self-hosted Compose, use `http://localhost:7016/v1`.

## Client configuration

Configure MCP clients to spawn the local stdio command. Example shape:

```json
{
  "mcpServers": {
    "exponential": {
      "command": "pnpm",
      "args": ["--filter", "@exponential/mcp", "exec", "exponential-mcp"],
      "env": {
        "EXPONENTIAL_TOKEN": "pat_your_token",
        "EXPONENTIAL_API_URL": "http://localhost:7016/v1"
      }
    }
  }
}
```

Keep tokens in your client secret store or environment manager when possible.
Do not commit PAT values into repository files.

## Smoke test

Use the MCP inspector or your client UI to verify:

- the tool list contains exactly the six v0 read-only tools
- `search_issues` returns a JSON text payload with `status` and `data`
- `get_issue` can read a known issue id or identifier
- no `create_*`, `update_*`, `delete_*`, or comment-listing tool appears

Example inspector command:

```bash
EXPONENTIAL_TOKEN=pat_your_token \
EXPONENTIAL_API_URL=http://localhost:7016/v1 \
npx @modelcontextprotocol/inspector pnpm --filter @exponential/mcp exec exponential-mcp
```

## Errors

Missing `EXPONENTIAL_TOKEN` fails before the server starts. API errors are
returned as MCP tool errors with HTTP status and problem title while omitting
authorization, token, cookie, and secret fields.

## Follow-up work

Write tools need a separate spec covering audit logs, idempotency, rate limits,
scope checks, and safe retries. Remote MCP transport and OAuth also require a
separate design before implementation.
