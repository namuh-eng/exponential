# Exponential MCP

Exponential MCP is a local stdio server for AI clients that need access to
Exponential issues, projects, and cycles. It supports both read-only queries
and write operations (create/update issues, comment, triage).

The reusable server package is `packages/mcp-server`. The stdio runtime is
`apps/mcp` and exposes the `exponential-mcp` binary.

## Scope

MCP is local-only and stdio-only. All tools call the generated TypeScript SDK
against the Go API and inherit the same personal access token authorization
boundary as the CLI.

### Read-only tools

- `search_issues` — full-text search across workspace issues
- `get_issue` — fetch a single issue by id or identifier
- `list_my_issues` — issues assigned to/created by/subscribed by the
  authenticated user
- `list_projects` — list workspace projects
- `get_project` — fetch a single project by slug
- `list_team_cycles` — list cycles for a team

### Write tools

These tools are annotated with `readOnlyHint: false`. They mutate workspace
data and require a PAT with write access.

- `create_issue` — create a new issue in the specified team. Required fields:
  `title`, `team_id`. Optional: `description`, `state_id`, `priority`
  (`none`/`urgent`/`high`/`medium`/`low`), `assignee_id`, `project_id`,
  `cycle_id`, `estimate`, `due_date`.
- `update_issue` — update an existing issue by id or identifier. Required:
  `id`. Optional fields to change: `title`, `description`, `state_id`,
  `priority`, `assignee_id`, `project_id`, `cycle_id`, `estimate`,
  `due_date`, `archive`.
- `add_comment` — add a plain-text comment to an issue. Required: `issueId`,
  `body`.
- `triage_issue` — accept or decline a single issue in a team's triage queue.
  Required: `teamKey`, `issueId`, `action` (`accept`/`decline`). When
  accepting, supply `destinationStateId` (workflow state UUID) to move the
  issue out of triage. Optional: `priority`, `assigneeId`, `reason`,
  `comment`. Annotated with `destructiveHint: true`.

Not included:

- issue comment listing (the OpenAPI/SDK contract does not expose a
  comment-read endpoint yet)
- HTTP transport
- OAuth setup
- public or hosted remote MCP
- direct database access
- destructive deletes

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

- the tool list contains all ten tools (six read-only + four write)
- `search_issues` returns a JSON text payload with `status` and `data`
- `get_issue` can read a known issue id or identifier
- `create_issue` creates an issue and returns the new issue object
- `add_comment` adds a comment and returns the created comment
- read-only tools have `readOnlyHint: true`; write tools have
  `readOnlyHint: false`

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

Remote MCP transport and OAuth require a separate design before implementation
(tracked in #590).
