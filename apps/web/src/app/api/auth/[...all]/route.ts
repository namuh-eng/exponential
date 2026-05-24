import { auth } from "@/lib/auth";
import { headlessAuthProvidersEnabled } from "@/lib/headless-api";
import {
  type WorkspaceAuthMethod,
  isWorkspaceAuthMethodAllowed,
  resolveWorkspaceAuthPolicy,
} from "@/lib/workspace-auth-methods";
import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";

const authHandlers = toNextJsHandler(auth);

function kratosPublicUrl() {
  return (
    process.env.EXPONENTIAL_KRATOS_PUBLIC_URL ?? "http://localhost:4433"
  ).replace(/\/$/, "");
}

async function proxyKratosRequest(request: Request) {
  const url = new URL(request.url);
  const marker = "/api/auth/kratos";
  const suffix = url.pathname.includes(marker)
    ? url.pathname.slice(url.pathname.indexOf(marker) + marker.length)
    : "";
  if (!suffix) return null;

  const upstreamUrl = `${kratosPublicUrl()}${suffix || "/"}${url.search}`;
  const headers = new Headers(request.headers);
  headers.set("host", new URL(kratosPublicUrl()).host);
  const upstream = await fetch(upstreamUrl, {
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

async function readJsonBody(request: Request) {
  return (await request
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null;
}

function authMethodError(method: WorkspaceAuthMethod) {
  return NextResponse.json(
    {
      error:
        method === "google"
          ? "Google authentication is disabled for this workspace."
          : "Email and passkey authentication is disabled for this workspace.",
      code: "WORKSPACE_AUTH_METHOD_DISABLED",
    },
    { status: 403 },
  );
}

async function enforceWorkspaceAuthMethod(
  request: Request,
  method: WorkspaceAuthMethod,
  callbackUrl: string | null | undefined,
  email?: string | null,
) {
  const requestUrl = new URL(request.url);
  const policy = await resolveWorkspaceAuthPolicy({
    callbackUrl,
    baseUrl: requestUrl.origin,
    email,
  });

  if (!isWorkspaceAuthMethodAllowed(policy, method)) {
    return authMethodError(method);
  }

  return null;
}

export async function GET(request: Request) {
  if (headlessAuthProvidersEnabled()) {
    const kratosResponse = await proxyKratosRequest(request);
    if (kratosResponse) return kratosResponse;
  }

  const url = new URL(request.url);
  if (url.pathname.endsWith("/magic-link/verify")) {
    const blocked = await enforceWorkspaceAuthMethod(
      request,
      "emailPasskey",
      url.searchParams.get("callbackURL"),
    );
    if (blocked) {
      return blocked;
    }
  }

  return authHandlers.GET(request);
}

export async function POST(request: Request) {
  if (headlessAuthProvidersEnabled()) {
    const kratosResponse = await proxyKratosRequest(request);
    if (kratosResponse) return kratosResponse;
  }

  const url = new URL(request.url);

  if (url.pathname.endsWith("/sign-in/social")) {
    const body = await readJsonBody(request);
    if (body?.provider === "google") {
      const blocked = await enforceWorkspaceAuthMethod(
        request,
        "google",
        typeof body.callbackURL === "string" ? body.callbackURL : null,
      );
      if (blocked) {
        return blocked;
      }
    }
  }

  if (url.pathname.endsWith("/sign-in/magic-link")) {
    const body = await readJsonBody(request);
    const blocked = await enforceWorkspaceAuthMethod(
      request,
      "emailPasskey",
      typeof body?.callbackURL === "string" ? body.callbackURL : null,
      typeof body?.email === "string" ? body.email : null,
    );
    if (blocked) {
      return blocked;
    }
  }

  if (url.pathname.endsWith("/passkey/verify-authentication")) {
    const callbackUrl = request.headers.get("x-workspace-callback-url");
    const blocked = await enforceWorkspaceAuthMethod(
      request,
      "emailPasskey",
      callbackUrl,
    );
    if (blocked) {
      return blocked;
    }
  }

  return authHandlers.POST(request);
}
