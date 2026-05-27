import { createServerApiClientFromRequest } from "@/lib/server-api-client";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/accept-invite", request.url));
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!sameOriginRequest(request, url)) {
    return NextResponse.json(
      { code: "invalid_origin", message: "Invalid request origin" },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const token = String(form.get("token") ?? "").trim();
  if (!token) {
    return NextResponse.redirect(new URL("/accept-invite", url));
  }

  const client = createServerApiClientFromRequest(request);
  const accepted = await client.POST("/workspaces/accept-invite", {
    body: { token },
  });

  if (!accepted.data) {
    return NextResponse.redirect(
      new URL(`/accept-invite?token=${encodeURIComponent(token)}`, url),
    );
  }

  const response = NextResponse.redirect(
    new URL(
      `/${accepted.data.workspaceSlug}/team/${accepted.data.teamKey}/all`,
      url,
    ),
  );
  const cookieOptions = {
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
  response.cookies.set(
    "activeWorkspaceId",
    accepted.data.workspaceId,
    cookieOptions,
  );
  response.cookies.set(
    "activeWorkspaceSlug",
    accepted.data.workspaceSlug,
    cookieOptions,
  );
  return response;
}

function sameOriginRequest(request: Request, target: URL) {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === target.origin;
  }
  const referer = request.headers.get("referer");
  if (!referer) {
    return false;
  }
  try {
    return new URL(referer).origin === target.origin;
  } catch {
    return false;
  }
}
