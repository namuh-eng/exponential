import { auth } from "@/lib/auth";
import {
  type WorkspaceAuthMethod,
  isWorkspaceAuthMethodAllowed,
  resolveWorkspaceAuthPolicy,
} from "@/lib/workspace-auth-methods";
import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";

const authHandlers = toNextJsHandler(auth);

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
