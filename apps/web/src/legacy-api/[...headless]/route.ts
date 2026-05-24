import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member } from "@/lib/db/schema";
import { mintInternalApiToken } from "@/lib/headless-api";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function headlessProxyEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_API_PROXY !== "false";
}

function apiBaseUrl() {
  return (
    process.env.EXPONENTIAL_API_URL ?? "http://localhost:3016/v1"
  ).replace(/\/$/, "");
}

async function fallbackWorkspaceId(userId: string) {
  const [firstMembership] = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);
  return firstMembership?.workspaceId ?? null;
}

function publicHeadlessPath(path: string) {
  return (
    path === "auth/provider-capabilities" ||
    path === "auth/saml/discovery" ||
    path === "oauth/token" ||
    path === "test/create-session"
  );
}

async function proxyPublicHeadless(request: Request, path: string) {
  const sourceUrl = new URL(request.url);
  const targetUrl = `${apiBaseUrl()}/${path}${sourceUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete("host");

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.clone().arrayBuffer(),
    redirect: "manual",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

async function proxyHeadless(
  request: Request,
  params: Promise<{ headless?: string[] }>,
) {
  if (!headlessProxyEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const path = (await params).headless?.join("/") ?? "";
  if (!path) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (publicHeadlessPath(path)) {
    return proxyPublicHeadless(request, path);
  }

  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const workspaceId =
    (await resolveRequestWorkspaceId(session.user.id, request)) ??
    (await fallbackWorkspaceId(session.user.id));
  if (!workspaceId) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  const token = await mintInternalApiToken({
    userId: session.user.id,
    workspaceId,
  });
  const sourceUrl = new URL(request.url);
  const targetUrl = `${apiBaseUrl()}/${path}${sourceUrl.search}`;
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("x-workspace-id", workspaceId);
  headers.delete("host");

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.clone().arrayBuffer(),
    redirect: "manual",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ headless?: string[] }> },
) {
  return proxyHeadless(request, params);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ headless?: string[] }> },
) {
  return proxyHeadless(request, params);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ headless?: string[] }> },
) {
  return proxyHeadless(request, params);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ headless?: string[] }> },
) {
  return proxyHeadless(request, params);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ headless?: string[] }> },
) {
  return proxyHeadless(request, params);
}
