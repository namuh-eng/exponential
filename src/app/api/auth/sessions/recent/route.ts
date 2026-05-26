import { getRecentSessionsForRequest } from "@/lib/auth-recent-sessions";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = url.searchParams.get("host");
  const result = await getRecentSessionsForRequest({
    headers: request.headers,
    host,
    callbackUrl: url.searchParams.get("callbackUrl"),
    baseUrl: url.origin,
  });

  if (result.entries.length === 0) {
    return NextResponse.json({ entries: [], recognizedOrigin: false });
  }

  return NextResponse.json(result);
}
