export function syncWebSocketUrl(input) {
  const base = new URL(input.baseUrl ?? "http://localhost:7016/v1");
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/$/, "")}/sync/ws`;
  base.searchParams.set("version", String(input.version ?? 0));
  base.searchParams.set("access_token", input.token);
  return base.toString();
}
