import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./generated.js";

export type ExponentialClient = ReturnType<typeof createExponentialClient>;

export function createExponentialClient(options: {
  baseUrl?: string;
  token?: string;
  fetch?: typeof fetch;
}) {
  const auth: Middleware = {
    async onRequest({ request }) {
      if (options.token) {
        request.headers.set("Authorization", `Bearer ${options.token}`);
      }
      return request;
    },
  };
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? "http://localhost:7016/v1",
    fetch: options.fetch,
  });
  client.use(auth);
  return client;
}

export type { components, paths } from "./generated.js";

export {
  syncWebSocketUrl,
  type SyncMessage,
  type SyncOperation,
} from "./sync.js";
