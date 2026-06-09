# @expn/sdk

Generated TypeScript SDK for the Exponential headless API.

```ts
import { createExponentialClient } from "@expn/sdk";

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
