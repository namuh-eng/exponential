# @exponential/cli

Command-line interface for Exponential.

## Install

```bash
npm install -g @exponential/cli
```

## Configure

Use a personal access token from Exponential:

```bash
export EXPONENTIAL_TOKEN=pat_your_token
export EXPONENTIAL_API_URL=https://your-exponential.example.com/v1
```

For local development or self-hosted Compose:

```bash
export EXPONENTIAL_API_URL=http://localhost:7016/v1
```

You can also store local config:

```bash
exponential login --token pat_your_token --api-url http://localhost:7016/v1
```

## Usage

```bash
exponential --help
exponential doctor --json
exponential issue ls
exponential issue view EXP-1
exponential project ls
```

Legacy plural commands keep JSON as their default output for automation. New
singular aliases use human-readable output only when stdout is a TTY. Use
`--json` to force JSON.

Full docs: <https://github.com/namuh-eng/exponential/blob/main/docs/cli.md>
