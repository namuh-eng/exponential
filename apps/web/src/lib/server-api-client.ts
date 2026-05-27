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
  });
}

export function createServerApiClientFromRequest(request: Request) {
  return createExponentialClient({
    baseUrl: apiBaseUrl(),
    cookie: request.headers.get("cookie") ?? "",
  });
}

export function createServerApiClientFromHeaders(headerList: Headers) {
  return createExponentialClient({
    baseUrl: apiBaseUrl(),
    cookie: headerList.get("cookie") ?? "",
  });
}
