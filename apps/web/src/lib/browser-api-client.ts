"use client";

import { createExponentialClient } from "@exponential/sdk";

function browserApiBaseUrl() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL("/api", window.location.origin)
      .toString()
      .replace(/\/$/, "");
  }
  return "http://localhost/api";
}

export function createBrowserApiClient() {
  return createExponentialClient({
    baseUrl: browserApiBaseUrl(),
    fetch: (input, init) => globalThis.fetch(input, init),
  });
}

export function apiErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.title === "string") return record.title;
  }
  return fallback;
}
