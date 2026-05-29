import { createNoStoreServerApiClientFromRequest } from "@/lib/server-api-client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_POST_LOGIN_PATH = "/inbox";

function safeLocalCallback(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_POST_LOGIN_PATH;
  }
  return value;
}

function publicOrigin(requestUrl: URL) {
  const configured =
    process.env.PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to the request URL when deployment config is invalid.
    }
  }
  return requestUrl.origin;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const callbackUrl = safeLocalCallback(
    requestUrl.searchParams.get("callbackUrl"),
  );
  const origin = publicOrigin(requestUrl);
  const client = createNoStoreServerApiClientFromRequest(request);
  const session = await client.GET("/auth/session");

  if (session.response.status === 401 || !session.data) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    loginUrl.searchParams.set("error", "session_not_created");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(callbackUrl, origin));
}
