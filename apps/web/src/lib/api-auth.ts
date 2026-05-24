import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiKey, member, user } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

type BrowserSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

export type ApiSession =
  | BrowserSession
  | {
      user: {
        id: string;
        name: string;
        email: string;
        image: string | null;
      };
      apiKey: {
        id: string;
        workspaceId: string;
        memberRole: string;
      };
    };

const API_KEY_PREFIX = "lin_api_";

type KratosWhoami = {
  identity?: {
    traits?: { email?: unknown };
  };
};

function headlessAuthEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_AUTH_PROVIDERS === "true";
}

function kratosPublicUrl() {
  return (
    process.env.EXPONENTIAL_KRATOS_PUBLIC_URL ??
    process.env.EXPONENTIAL_API_KRATOS_URL ??
    "http://localhost:4433"
  ).replace(/\/$/, "");
}

export function createApiKeyHash(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function readApiKeyToken(headerList: Headers) {
  const authorization = headerList.get("authorization")?.trim();
  if (authorization) {
    const [scheme, ...tokenParts] = authorization.split(/\s+/);
    const token = tokenParts.join(" ").trim();
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token;
    }

    return null;
  }

  const linearApiKey = headerList.get("linear-api-key")?.trim();
  return linearApiKey || null;
}

async function validateApiKey(headerList: Headers): Promise<ApiSession | null> {
  const token = readApiKeyToken(headerList);
  if (!token || !token.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const [record] = await db
    .select({
      apiKeyId: apiKey.id,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
      workspaceId: apiKey.workspaceId,
      memberRole: member.role,
    })
    .from(apiKey)
    .innerJoin(user, eq(apiKey.userId, user.id))
    .innerJoin(
      member,
      and(
        eq(member.userId, apiKey.userId),
        eq(member.workspaceId, apiKey.workspaceId),
      ),
    )
    .where(eq(apiKey.keyHash, createApiKeyHash(token)))
    .limit(1);

  if (!record) {
    return null;
  }

  await db
    .update(apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKey.id, record.apiKeyId));

  return {
    user: {
      id: record.userId,
      name: record.userName,
      email: record.userEmail,
      image: record.userImage,
    },
    apiKey: {
      id: record.apiKeyId,
      workspaceId: record.workspaceId,
      memberRole: record.memberRole,
    },
  };
}

async function validateKratosSession(
  headerList: Headers,
): Promise<ApiSession | null> {
  if (!headlessAuthEnabled()) {
    return null;
  }

  const cookie = headerList.get("cookie") ?? "";
  const sessionToken = headerList.get("x-session-token") ?? "";
  if (!cookie && !sessionToken) {
    return null;
  }

  const kratosHeaders = new Headers({ accept: "application/json" });
  if (cookie) kratosHeaders.set("cookie", cookie);
  if (sessionToken) kratosHeaders.set("x-session-token", sessionToken);

  const response = await fetch(`${kratosPublicUrl()}/sessions/whoami`, {
    headers: kratosHeaders,
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const whoami = (await response
    .json()
    .catch(() => null)) as KratosWhoami | null;
  const email =
    typeof whoami?.identity?.traits?.email === "string"
      ? whoami.identity.traits.email.trim().toLowerCase()
      : "";
  if (!email) {
    return null;
  }

  const [record] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (!record) {
    return null;
  }

  return {
    user: {
      id: record.id,
      name: record.name,
      email: record.email,
      image: record.image,
    },
    session: {
      id: "kratos_session",
      token: "kratos_session",
      userId: record.id,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as unknown as ApiSession;
}

export async function requireApiSession() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (session) {
    return { response: null, session: session as ApiSession };
  }

  const kratosSession = await validateKratosSession(requestHeaders);
  if (kratosSession) {
    return { response: null, session: kratosSession };
  }

  const apiKeySession = await validateApiKey(requestHeaders);
  if (!apiKeySession) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      session: null,
    };
  }

  return { response: null, session: apiKeySession };
}
