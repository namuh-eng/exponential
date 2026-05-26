import { describe, expect, it } from "vitest";
import { createExponentialClient } from "./index.js";

describe("createExponentialClient", () => {
  it("attaches bearer auth", async () => {
    let authorization: string | null = null;
    const client = createExponentialClient({
      token: "lin_api_test",
      fetch: async (request: RequestInfo | URL) => {
        authorization = new Request(request).headers.get("authorization");
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await client.GET("/issues", {});
    expect(authorization).toBe("Bearer lin_api_test");
  });
});
