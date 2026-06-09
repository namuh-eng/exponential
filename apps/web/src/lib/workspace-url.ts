export function workspaceUrlHost(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!raw) return "exponential.app";
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}
