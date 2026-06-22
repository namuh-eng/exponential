export type SyncOperation = {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  op_type: string;
  payload: unknown;
  version: number;
  created_at: string;
  created_by?: string | null;
};

export type SyncReplayMessage = {
  type: "replay";
  operations: SyncOperation[];
};

export type SyncOperationMessage = {
  type: "operation";
  operations: SyncOperation[];
};

export type SyncMessage = SyncReplayMessage | SyncOperationMessage;

export type SyncVersionStore = {
  get(): number | undefined;
  set(version: number): void;
};

type WebSocketLike = {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  close(code?: number, reason?: string): void;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

export type SyncSubscription = {
  close(): void;
  getLastVersion(): number;
};

export function syncWebSocketUrl(input: {
  baseUrl?: string;
  token?: string;
  version?: number;
}) {
  const base = new URL(input.baseUrl ?? "http://localhost:7016/v1");
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/$/, "")}/sync/ws`;
  base.searchParams.set("version", String(input.version ?? 0));
  // Browser WebSocket cannot set Authorization headers. Cookie-authenticated web
  // clients omit this query param; PAT/API-key clients can pass a token here.
  if (input.token) {
    base.searchParams.set("access_token", input.token);
  }
  return base.toString();
}

export function createLocalStorageVersionStore(
  key = "exponential:sync:last-version",
): SyncVersionStore {
  return {
    get() {
      if (typeof localStorage === "undefined") return undefined;
      const raw = localStorage.getItem(key);
      if (!raw) return undefined;
      const version = Number.parseInt(raw, 10);
      return Number.isFinite(version) && version >= 0 ? version : undefined;
    },
    set(version) {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(key, String(version));
    },
  };
}

export function subscribeToSync(input: {
  baseUrl?: string;
  token?: string;
  version?: number;
  versionStore?: SyncVersionStore;
  onOperations(operations: SyncOperation[], message: SyncMessage): void;
  onStatus?: (status: {
    state: "connected" | "reconnecting";
    attempt: number;
  }) => void;
  onError?: (error: unknown) => void;
  minReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  WebSocket?: WebSocketConstructor;
  setTimeout?: (handler: () => void, timeout: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}): SyncSubscription {
  const Socket = input.WebSocket ?? globalThis.WebSocket;
  if (!Socket) {
    throw new Error("WebSocket is not available in this environment");
  }
  const setTimer =
    input.setTimeout ??
    ((handler: () => void, timeout: number) =>
      globalThis.setTimeout(handler, timeout));
  const clearTimer =
    input.clearTimeout ??
    ((handle: unknown) =>
      globalThis.clearTimeout(
        handle as ReturnType<typeof globalThis.setTimeout>,
      ));
  const minDelay = Math.max(1, input.minReconnectDelayMs ?? 250);
  const maxDelay = Math.max(minDelay, input.maxReconnectDelayMs ?? 5000);
  const seenOperationIds = new Set<string>();
  let closed = false;
  let socket: WebSocketLike | null = null;
  let reconnectTimer: unknown;
  let attempt = 0;
  let lastVersion = Math.max(
    0,
    input.versionStore?.get() ?? input.version ?? 0,
  );

  const persistVersion = (version: number) => {
    if (version <= lastVersion) return;
    lastVersion = version;
    input.versionStore?.set(version);
  };

  const applyMessage = (message: SyncMessage) => {
    const nextOperations: SyncOperation[] = [];
    for (const operation of message.operations) {
      if (
        seenOperationIds.has(operation.id) ||
        operation.version <= lastVersion
      ) {
        seenOperationIds.add(operation.id);
        continue;
      }
      seenOperationIds.add(operation.id);
      nextOperations.push(operation);
    }
    if (nextOperations.length === 0) return;
    input.onOperations(nextOperations, message);
    for (const operation of nextOperations) {
      persistVersion(operation.version);
    }
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = Math.min(maxDelay, minDelay * 2 ** Math.max(0, attempt));
    input.onStatus?.({ state: "reconnecting", attempt });
    reconnectTimer = setTimer(connect, delay);
    attempt += 1;
  };

  function connect() {
    if (closed) return;
    const nextSocket = new Socket(
      syncWebSocketUrl({
        baseUrl: input.baseUrl,
        token: input.token,
        version: lastVersion,
      }),
    );
    socket = nextSocket;
    nextSocket.onopen = () => {
      attempt = 0;
      input.onStatus?.({ state: "connected", attempt });
    };
    nextSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as SyncMessage;
        if (
          (message.type === "replay" || message.type === "operation") &&
          Array.isArray(message.operations)
        ) {
          applyMessage(message);
        }
      } catch (error) {
        input.onError?.(error);
      }
    };
    nextSocket.onerror = (event) => input.onError?.(event);
    nextSocket.onclose = () => {
      if (socket === nextSocket) {
        socket = null;
      }
      scheduleReconnect();
    };
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer !== undefined) {
        clearTimer(reconnectTimer);
      }
      socket?.close(1000, "closed");
      socket = null;
    },
    getLastVersion() {
      return lastVersion;
    },
  };
}
