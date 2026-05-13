import { randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { ensureCanonicalWorkspaceForUser } from "@/lib/canonical-workspace";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import {
  DATABASE_BOOTSTRAP_MESSAGE,
  DATABASE_BOOTSTRAP_TITLE,
  shouldRenderDatabaseBootstrapError,
} from "@/lib/dev-database-error";
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

  try {
    return await createTestSession(email, body?.name, request.url);
  } catch (error) {
    if (shouldRenderDatabaseBootstrapError(error)) {
      return NextResponse.json(
        {
          error: DATABASE_BOOTSTRAP_TITLE,
          message: DATABASE_BOOTSTRAP_MESSAGE,
          setup: ["make dev-services", "npm run db:push"],
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
  requestUrl: string,
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
  );
  const signedToken = `${createdSession.token}.${await makeSignature(
    createdSession.token,
    authContext.secret,
  )}`;
  const sessionCookie = authContext.authCookies.sessionToken;
  const shouldSecureActiveWorkspaceCookie =
    new URL(requestUrl).protocol === "https:";

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
