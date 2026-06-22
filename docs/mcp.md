# Exponential MCP

Exponential MCP lets AI clients access Exponential issues, projects, cycles, and
views through authenticated read/write tools. Exponential exposes two MCP entry
points:

- Hosted remote Streamable HTTP endpoint: `https://<api-host>/v1/mcp`
- Local stdio package: `packages/mcp-server` via the `apps/mcp` `exponential-mcp` binary

Local development uses the Go API endpoint `http://localhost:7016/v1/mcp`.

## Authentication

Remote MCP requires a personal access token in the HTTP `Authorization` header:

```text
Authorization: Bearer ***
```

Browser sessions are rejected for remote MCP. Revoked personal access tokens stop
working on the next request because the endpoint uses the same Go API PAT
authentication middleware as the rest of `/v1`.

PAT scope rules:

- Read tools require `read`.
- Mutating tools require `write`.
- Tool calls are written to `personal_access_token_audit_log` with action
  `mcp_tool_call`; secret-like arguments and raw comment/description bodies are
  redacted from metadata.

## Remote tools

Read tools:

- `exponential_search_issues`
- `exponential_get_issue`
- `exponential_list_projects`
- `exponential_get_project`
- `exponential_list_teams`
- `exponential_get_team_context`
- `exponential_list_team_issues`
- `exponential_list_team_cycles`
- `exponential_list_views`
- `exponential_get_view`

Write tools:

- `exponential_create_issue`
- `exponential_update_issue`
- `exponential_create_project`
- `exponential_update_project`
- `exponential_create_view`
- `exponential_update_view`
- `exponential_create_comment`
- `exponential_update_comment`
- `exponential_delete_comment`

Customer tools and comment read/list tools are intentionally omitted until those
API contracts exist. Private-team data follows the same visibility boundary as
the Go API: workspace admins can see all teams, non-admins only see public teams
and private teams they belong to, and guests cannot discover public-team issue
data unless they are team members.

## Client configuration

### Codex, Claude, and Cursor

Use an HTTP MCP server entry with an authorization header:

```json
{
  "mcpServers": {
    "exponential": {
      "type": "http",
      "url": "https://<api-host>/v1/mcp",
      "headers": {
        "Authorization": "Bearer pat_your_token"
      }
    }
  }
}
```

### Generic MCP clients

Send JSON-RPC 2.0 requests to `/v1/mcp` over HTTP:

```bash
curl -X POST "https://<api-host>/v1/mcp" \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Local stdio server

The local stdio server remains available for clients that prefer spawning a
process. It calls the generated TypeScript SDK against the Go API.

```bash
bun install
EXPONENTIAL_TOKEN=pat_your_token \
EXPONENTIAL_API_URL=http://localhost:7016/v1 \
bun run --filter @exponential/mcp mcp
```

Example local client configuration:

```json
{
  "mcpServers": {
    "exponential": {
      "command": "bun",
      "args": ["--filter", "@exponential/mcp", "run", "mcp"],
      "env": {
        "EXPONENTIAL_TOKEN": "pat_your_token",
        "EXPONENTIAL_API_URL": "http://localhost:7016/v1"
      }
    }
  }
}
```

Keep tokens in your client secret store or environment manager when possible. Do
not commit PAT values into repository files.

## Smoke test

Use the MCP inspector or your client UI to verify:

- remote `tools/list` includes the `exponential_*` read/write tools above
- a read-scoped PAT can call `exponential_search_issues`
- a read-scoped PAT receives a tool error for `exponential_create_issue`
- local stdio clients can list and call the generated SDK-backed tools
- revoking the PAT immediately makes `/v1/mcp` return unauthorized
- audit log rows use `mcp_tool_call` and redact authorization, token, cookie,
  secret, body, and description values

Example local inspector command:

```bash
EXPONENTIAL_TOKEN=pat_your_token \
EXPONENTIAL_API_URL=http://localhost:7016/v1 \
npx @modelcontextprotocol/inspector bun run --filter @exponential/mcp mcp
```

## Errors

Remote MCP returns JSON-RPC errors for malformed MCP requests and MCP tool errors
for tool validation/API failures. Missing local `EXPONENTIAL_TOKEN` fails before
the stdio server starts. API error details omit authorization, token, cookie, and
secret fields.
