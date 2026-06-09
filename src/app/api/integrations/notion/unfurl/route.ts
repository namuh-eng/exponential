import {
  readBearerToken,
  resolveNotionUnfurl,
  toNotionUnfurlResponse,
} from "@/lib/notion-rich-previews";
import { NextResponse } from "next/server";

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function readTargetUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const queryUrl = requestUrl.searchParams.get("url");
  if (queryUrl) return queryUrl;

  if (request.method !== "POST") return null;
  const body = (await request.json().catch(() => null)) as {
    uri?: unknown;
    url?: unknown;
  } | null;
  if (typeof body?.uri === "string") return body.uri;
  return typeof body?.url === "string" ? body.url : null;
}

async function handle(request: Request) {
  const targetUrl = await readTargetUrl(request);
  if (!targetUrl) {
    return withNoStore(
      NextResponse.json({ error: "URL is required" }, { status: 400 }),
    );
  }

  const preview = await resolveNotionUnfurl(
    targetUrl,
    readBearerToken(request),
    request,
  );
  return withNoStore(
    NextResponse.json(toNotionUnfurlResponse(targetUrl, preview)),
  );
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function DELETE(request: Request) {
  const targetUrl = await readTargetUrl(request);
  return withNoStore(
    NextResponse.json({
      success: true,
      ...(targetUrl ? { uri: targetUrl } : {}),
    }),
  );
}
