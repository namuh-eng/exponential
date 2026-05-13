const DEV_APP_URL = "http://localhost:3015";

export function getConfiguredAppUrl() {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    DEV_APP_URL
  );
}

export function getRequestAppUrl(request: Request) {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(request.url).origin
  );
}

export function buildAppUrl(baseUrl: string, path: string) {
  return new URL(path, baseUrl).toString();
}
