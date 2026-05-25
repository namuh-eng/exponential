import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { apiKey, member, user } from "@/lib/db/schema";
import { getWebSession } from "@/lib/web-session";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

type BrowserSession = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  session?: {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
  };
};

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

async function validateBrowserSession(
  headerList: Headers,
): Promise<ApiSession | null> {
  const webSession = await getWebSession(headerList);
  if (!webSession) return null;
  return { user: webSession.user } as ApiSession;
}

export async function requireApiSession() {
  const requestHeaders = await headers();

  const browserSession = await validateBrowserSession(requestHeaders);
  if (browserSession) {
    return { response: null, session: browserSession };
  }

  const apiKeySession = await validateApiKey(requestHeaders);
  if (apiKeySession) {
    return { response: null, session: apiKeySession };
  }

  if (process.env.NODE_ENV === "test") {
    const { auth } = await import("test-auth");
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session) {
      return { response: null, session: session as ApiSession };
    }
  }

  return {
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    session: null,
  };
}
