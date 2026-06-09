import { getPreflightChecks } from "@/lib/health/preflight";
import { NextResponse } from "next/server";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request): string {
  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || "anonymous";
}

function isRateLimited(request: Request): boolean {
  const now = Date.now();
  const key = clientKey(request);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_REQUESTS;
}

export async function GET(request: Request) {
  if (isRateLimited(request)) {
    return NextResponse.json(
      { error: "Too many preflight requests." },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  const checks = await getPreflightChecks(request);
  return NextResponse.json(
    { checks },
    { headers: { "Cache-Control": "no-store" } },
  );
}
