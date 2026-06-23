# @namuh-eng/expn-sdk

Generated TypeScript SDK for the Exponential headless API.

## Usage

```ts
import { createExponentialClient } from "@namuh-eng/expn-sdk";

const client = createExponentialClient({
  baseUrl: process.env.EXPONENTIAL_API_URL,
  token: process.env.EXPONENTIAL_TOKEN,
});

const { data, error } = await client.GET("/issues", {
  params: { query: { limit: 10 } },
});
```

The SDK is generated from `packages/proto/openapi.yaml` and is primarily used by
the Exponential CLI, MCP server, and web app runtime clients.

Use an API base URL that ends in `/v1`:

```bash
export EXPONENTIAL_API_URL=http://localhost:7016/v1
export EXPONENTIAL_TOKEN=pat_your_token
```

## Generation

Regenerate after changing `packages/proto/openapi.yaml`:

```bash
bun run --filter @namuh-eng/expn-sdk generate
```

The generated types are written to `packages/sdk/src/generated.ts`. Do not edit
that file by hand; update the OpenAPI contract instead.

If a contract change also affects the Go API, regenerate the Go stubs too:

```bash
scripts/generate-go-openapi.py
```

## Validation

```bash
bun run --filter @namuh-eng/expn-sdk typecheck
bun run --filter @namuh-eng/expn-sdk test
bun run --filter @namuh-eng/expn-sdk build
```

The repo-level `make check` command also verifies OpenAPI coverage, generated
Go stubs, and migrated web SDK usage.

## Consumers

- `apps/cli` publishes `@namuh-eng/expn-cli` and depends on this SDK.
- `packages/mcp-server` exposes read-only MCP tools through this SDK.
- `apps/web` uses SDK-backed clients for migrated runtime slices while keeping
  browser traffic same-origin through `/api/*` rewrites.
