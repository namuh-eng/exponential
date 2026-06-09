# Exponential CLI

The `exponential` CLI talks to the Go headless API through the generated
TypeScript SDK. It is intended for local development, self-hosted operations,
and scriptable issue/project workflows.

## Install and run

From a source checkout:

```bash
pnpm install
pnpm --filter @exponential/cli cli -- --help
```

When the workspace package is linked or installed, the binary name is:

```bash
exponential --help
```

## Authentication

The CLI uses personal access tokens. Tokens must start with `pat_`.

```bash
export EXPONENTIAL_TOKEN=pat_your_token
export EXPONENTIAL_API_URL=http://localhost:7016/v1
```

You can also store local config:

```bash
exponential login --token pat_your_token --api-url http://localhost:7016/v1
```

Environment variables take precedence over
`~/.config/exponential/config.json`.

## Output contract

Legacy plural commands remain JSON by default for compatibility:

```bash
exponential issues list
exponential projects list
```

New singular daily-driver aliases use human-readable output only when stdout is
a TTY:

```bash
exponential issue ls
exponential issue view EXP-1
exponential project ls
exponential project view roadmap
```

Piped, redirected, CI, and non-TTY output defaults to JSON. `--json` always
forces JSON:

```bash
exponential issue ls --json | jq '.issues[0].identifier'
```

`--format json|table|detail` is accepted, with `--json` taking precedence.

## Daily-driver commands

```bash
exponential whoami
exponential doctor
exponential config get
exponential config set --api-url http://localhost:7016/v1

exponential issue ls [--team-id <uuid>] [--cursor <cursor>] [--limit <n>]
exponential issue view <id-or-identifier>
exponential issue create --title <title> --team-id <uuid>
exponential issue update <id-or-identifier> [--title <title>] [--state-id <uuid>]

exponential project ls
exponential project view <slug>

exponential cycle current --team-key <key>
```

Issue create, update, and delete commands send an `Idempotency-Key`. If the user
does not pass `--idempotency-key`, the CLI generates one.

## Config and redaction

`config get` never prints full token values:

```bash
exponential config get
exponential config get token
```

Config files are written with user-only `0600` permissions.

## Troubleshooting

Run:

```bash
exponential doctor --json
```

Doctor checks the API URL, token presence, local config permissions, API health
at `/healthz` or `/api/healthz`, and authenticated profile access through
`/account/profile`.

Common failures:

- Missing token: set `EXPONENTIAL_TOKEN` or run `exponential login`.
- Wrong API URL: set `EXPONENTIAL_API_URL` to the API base URL ending in `/v1`.
- Auth failure: create a new PAT and verify it can call `GET /account/profile`.
- Self-host proxy failure: verify `/api/healthz` reaches the Go API service.
