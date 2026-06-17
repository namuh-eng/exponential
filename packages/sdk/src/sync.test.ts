import { describe, expect, it } from "vitest";
import {
  type SyncOperation,
  subscribeToSync,
  syncWebSocketUrl,
} from "./sync.js";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

function operation(id: string, version: number): SyncOperation {
  return {
    id,
    workspace_id: "workspace-1",
    entity_type: "issue",
    entity_id: "issue-1",
    op_type: "updated",
    payload: { id: "issue-1" },
    version,
    created_at: "2026-06-16T00:00:00Z",
    created_by: "user-1",
  };
}

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

  it("omits access_token for cookie-authenticated browser sockets", () => {
    expect(
      syncWebSocketUrl({ baseUrl: "http://app.test/api", version: 7 }),
    ).toBe("ws://app.test/api/sync/ws?version=7");
  });
});

describe("subscribeToSync", () => {
  it("applies replayed operations once and persists the highest version", () => {
    FakeWebSocket.instances = [];
    const applied: SyncOperation[] = [];
    const stored: number[] = [];
    const subscription = subscribeToSync({
      baseUrl: "https://api.example.com/v1",
      versionStore: { get: () => 1, set: (version) => stored.push(version) },
      WebSocket: FakeWebSocket,
      onOperations: (operations) => applied.push(...operations),
    });

    expect(FakeWebSocket.instances[0]?.url).toBe(
      "wss://api.example.com/v1/sync/ws?version=1",
    );
    FakeWebSocket.instances[0]?.emit({
      type: "replay",
      operations: [
        operation("old", 1),
        operation("op-2", 2),
        operation("op-2", 2),
      ],
    });

    expect(applied.map((op) => op.id)).toEqual(["op-2"]);
    expect(stored).toEqual([2]);
    expect(subscription.getLastVersion()).toBe(2);
    subscription.close();
  });

  it("reconnects with backoff from the last applied version", () => {
    FakeWebSocket.instances = [];
    const timers: Array<() => void> = [];
    const delays: number[] = [];
    const subscription = subscribeToSync({
      baseUrl: "http://api.example.com/v1",
      version: 5,
      minReconnectDelayMs: 10,
      maxReconnectDelayMs: 50,
      WebSocket: FakeWebSocket,
      setTimeout: (handler, timeout) => {
        timers.push(handler);
        delays.push(timeout);
        return handler;
      },
      clearTimeout: () => {},
      onOperations: () => {},
    });

    FakeWebSocket.instances[0]?.emit({
      type: "operation",
      operations: [operation("op-6", 6)],
    });
    FakeWebSocket.instances[0]?.onclose?.({} as CloseEvent);
    expect(delays).toEqual([10]);
    timers[0]?.();

    expect(FakeWebSocket.instances[1]?.url).toBe(
      "ws://api.example.com/v1/sync/ws?version=6",
    );
    subscription.close();
  });
});
