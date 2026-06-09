import { describe, expect, it } from "vitest";
import { syncWebSocketUrl } from "./sync.js";

describe("syncWebSocketUrl", () => {
  it("converts API base URL to sync websocket URL", () => {
    expect(
      syncWebSocketUrl({
        baseUrl: "https://api.example.com/v1",
        token: "pat_test",
        version: 42,
      }),
    ).toBe("wss://api.example.com/v1/sync/ws?version=42&access_token=pat_test");
  });
});
