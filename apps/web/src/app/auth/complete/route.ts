import { createNoStoreServerApiClientFromRequest } from "@/lib/server-api-client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_POST_LOGIN_PATH = "/inbox";
const BROWSER_SESSION_COOKIE_NAME = "exponential_session";

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

function hasBrowserSessionCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return cookieHeader
    .split(";")
    .some((part) => part.trim().startsWith(`${BROWSER_SESSION_COOKIE_NAME}=`));
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const callbackUrl = safeLocalCallback(
    requestUrl.searchParams.get("callbackUrl"),
  );
  const origin = publicOrigin(requestUrl);
  const redirectUrl = new URL(callbackUrl, origin);
  const client = createNoStoreServerApiClientFromRequest(request);
  const session = await client.GET("/auth/session");

  if (session.response.status !== 401 && session.data) {
    return NextResponse.redirect(redirectUrl);
  }

  // The Go OAuth callback has already created the browser session before it
  // sends the user here. In production, this server-side verification can be a
  // false negative if the web container cannot validate the just-issued cookie
  // through the public API path. If the browser did send a session cookie to the
  // completion route, continue to the original destination and let normal app
  // middleware/API requests validate the session on the next browser request.
  if (hasBrowserSessionCookie(request)) {
    console.warn(
      "auth complete session verification failed with cookie present",
      {
        status: session.response.status,
        callbackUrl,
      },
    );
    return NextResponse.redirect(redirectUrl);
  }

  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("callbackUrl", callbackUrl);
  loginUrl.searchParams.set("error", "session_not_created");
  return NextResponse.redirect(loginUrl);
}
