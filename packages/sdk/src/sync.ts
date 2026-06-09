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

export type SyncMessage = SyncReplayMessage;

export function syncWebSocketUrl(input: {
  baseUrl?: string;
  token: string;
  version?: number;
}) {
  const base = new URL(input.baseUrl ?? "http://localhost:7016/v1");
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/$/, "")}/sync/ws`;
  base.searchParams.set("version", String(input.version ?? 0));
  // Browser WebSocket cannot set Authorization headers. The CLI can pass this
  // token through a query parameter until a first-class WS auth handshake is
  // added. The Go endpoint still accepts normal Authorization for non-browser
  // clients and future SDK transports.
  base.searchParams.set("access_token", input.token);
  return base.toString();
}
