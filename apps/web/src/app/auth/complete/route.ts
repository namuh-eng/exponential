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

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const callbackUrl = safeLocalCallback(
    requestUrl.searchParams.get("callbackUrl"),
  );
  const client = createNoStoreServerApiClientFromRequest(request);
  const session = await client.GET("/auth/session");

  if (session.response.status === 401 || !session.data) {
    const loginUrl = new URL("/login", requestUrl);
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    loginUrl.searchParams.set("error", "session_not_created");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(callbackUrl, requestUrl));
}
