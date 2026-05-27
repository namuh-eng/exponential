import { createExponentialClient } from "@exponential/sdk";
import { headers as nextHeaders } from "next/headers";

function apiBaseUrl() {
  const raw = process.env.EXPONENTIAL_API_URL ?? "http://localhost:7016/v1";
  return raw.replace(/\/$/, "");
}

export async function createServerApiClient() {
  const headerList = await nextHeaders();
  return createExponentialClient({
    baseUrl: apiBaseUrl(),
    cookie: headerList.get("cookie") ?? "",
    headers: forwardedRequestHeaders(headerList),
  });
}

export function createServerApiClientFromRequest(request: Request) {
  return createExponentialClient({
    baseUrl: apiBaseUrl(),
    cookie: request.headers.get("cookie") ?? "",
    headers: forwardedRequestHeaders(request.headers),
  });
}

export function createServerApiClientFromHeaders(headerList: Headers) {
  return createExponentialClient({
    baseUrl: apiBaseUrl(),
    cookie: headerList.get("cookie") ?? "",
    headers: forwardedRequestHeaders(headerList),
  });
}

function forwardedRequestHeaders(headerList: Headers) {
  const headers = new Headers();
  const forwardedNames = [
    "origin",
    "referer",
    "x-workspace-id",
    "x-workspace-slug",
    "x-workspace-source-path",
  ];
  if (
    process.env.PLAYWRIGHT_TEST === "true" ||
    process.env.NODE_ENV === "test"
  ) {
    forwardedNames.push("x-test-client-ip");
  }
  for (const name of forwardedNames) {
    const value = headerList.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  if (!headers.has("origin") && !headers.has("referer")) {
    const rawOrigin =
      process.env.EXPONENTIAL_APP_URL ?? process.env.PUBLIC_BASE_URL;
    if (rawOrigin) {
      try {
        const origin = new URL(rawOrigin).origin;
        headers.set("origin", origin);
      } catch {
        // Ignore invalid deployment URL configuration; the API will enforce CSRF.
      }
    }
  }
  return headers;
}
