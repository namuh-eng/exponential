import { randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { ensureCanonicalWorkspaceForUser } from "@/lib/canonical-workspace";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import {
  DATABASE_BOOTSTRAP_MESSAGE,
  DATABASE_BOOTSTRAP_SETUP_COMMANDS,
  DATABASE_BOOTSTRAP_TITLE,
  shouldRenderDatabaseBootstrapError,
} from "@/lib/dev-database-error";
import { headlessAuthProvidersEnabled } from "@/lib/headless-api";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function randomToken(size: number) {
  return randomBytes(size).toString("base64url");
}

function normalizeSameSite(value: string | undefined) {
  const normalized = value?.toLowerCase();
  if (normalized === "strict") {
    return "strict" as const;
  }

  if (normalized === "none") {
    return "none" as const;
  }

  return "lax" as const;
}

export async function POST(request: Request) {
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.PLAYWRIGHT_TEST !== "true"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    name?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  if (headlessAuthProvidersEnabled()) {
    const upstream = await fetch(
      `${process.env.EXPONENTIAL_API_URL ?? "http://localhost:3016/v1"}/test/create-session`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent":
            request.headers.get("user-agent") ??
            "Playwright test browser session",
          "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "",
          "x-real-ip": request.headers.get("x-real-ip") ?? "",
        },
        body: JSON.stringify({ email, name: body?.name }),
      },
    );
    const payload = await upstream.json();
    const response = NextResponse.json(payload, { status: upstream.status });
    if (upstream.ok && payload?.sessionToken && payload?.workspace) {
      const shouldSecure = new URL(request.url).protocol === "https:";
      response.cookies.set("activeWorkspaceId", payload.workspace.id, {
        path: "/",
        sameSite: "lax",
        secure: shouldSecure,
      });
      response.cookies.set("activeWorkspaceSlug", payload.workspace.urlSlug, {
        path: "/",
        sameSite: "lax",
        secure: shouldSecure,
      });
      response.cookies.set("better-auth.session_token", payload.sessionToken, {
        expires: new Date(payload.expiresAt),
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: false,
      });
    }
    return response;
  }

  try {
    return await createTestSession(email, body?.name, request);
  } catch (error) {
    if (shouldRenderDatabaseBootstrapError(error)) {
      return NextResponse.json(
        {
          error: DATABASE_BOOTSTRAP_TITLE,
          message: DATABASE_BOOTSTRAP_MESSAGE,
          setup: DATABASE_BOOTSTRAP_SETUP_COMMANDS,
        },
        { status: 503 },
      );
    }

    throw error;
  }
}

async function createTestSession(
  email: string,
  name: string | undefined,
  request: Request,
) {
  const existingUser = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  const resolvedUser =
    existingUser[0] ??
    (
      await db
        .insert(user)
        .values({
          id: randomToken(24),
          email,
          name:
            name?.trim() ||
            email.split("@")[0]?.replaceAll(/[._-]+/g, " ") ||
            "Playwright User",
          emailVerified: true,
        })
        .returning({
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          emailVerified: user.emailVerified,
        })
    )[0];

  const canonicalContext = await ensureCanonicalWorkspaceForUser(
    resolvedUser.id,
  );

  const authContext = await auth.$context;
  const createdSession = await authContext.internalAdapter.createSession(
    resolvedUser.id,
    false,
    {
      userAgent:
        request.headers.get("user-agent")?.trim() ||
        "Playwright test browser session",
      ipAddress:
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip")?.trim() ||
        "",
    },
  );
  const signedToken = `${createdSession.token}.${await makeSignature(
    createdSession.token,
    authContext.secret,
  )}`;
  const sessionCookie = authContext.authCookies.sessionToken;
  const shouldSecureActiveWorkspaceCookie =
    new URL(request.url).protocol === "https:";

  const response = NextResponse.json({
    success: true,
    user: resolvedUser,
    sessionToken: signedToken,
    expiresAt: createdSession.expiresAt.toISOString(),
    workspace: canonicalContext.workspace,
    team: canonicalContext.team,
  });

  response.cookies.set("activeWorkspaceId", canonicalContext.workspace.id, {
    path: "/",
    sameSite: "lax",
    secure: shouldSecureActiveWorkspaceCookie,
  });
  response.cookies.set(
    "activeWorkspaceSlug",
    canonicalContext.workspace.urlSlug,
    {
      path: "/",
      sameSite: "lax",
      secure: shouldSecureActiveWorkspaceCookie,
    },
  );

  response.cookies.set(sessionCookie.name, signedToken, {
    expires: createdSession.expiresAt,
    httpOnly: sessionCookie.attributes.httpOnly ?? true,
    path: sessionCookie.attributes.path ?? "/",
    sameSite: normalizeSameSite(sessionCookie.attributes.sameSite),
    secure: sessionCookie.attributes.secure ?? false,
  });

  return response;
}
