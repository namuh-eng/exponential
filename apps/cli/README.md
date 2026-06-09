# @expn/cli

Command-line interface for Exponential.

## Install

```bash
npm install -g @expn/cli
```

The package installs both `expn` and `exponential` binaries. `expn` is the short
daily-driver alias; `exponential` remains available for scripts.

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
expn login --token pat_your_token --api-url http://localhost:7016/v1
```

## Usage

```bash
expn --help
expn doctor --json
expn issue ls
expn issue view EXP-1
expn project ls
```

Legacy plural commands keep JSON as their default output for automation. New
singular aliases use human-readable output only when stdout is a TTY. Use
`--json` to force JSON.

Full docs: <https://github.com/namuh-eng/exponential/blob/main/docs/cli.md>
