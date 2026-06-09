import { createHash } from "node:crypto";
import { asRecord, readWorkspaceApiSettings } from "@/lib/api-settings";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiKey, member, user, workspace } from "@/lib/db/schema";
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
    }
  | {
      user: {
        id: string;
        name: string;
        email: string;
        image: string | null;
      };
      oauthToken: {
        id: string;
        workspaceId: string;
        applicationId: string;
        clientId: string;
        scopes: string[];
      };
    };

const API_KEY_PREFIX = "lin_api_";
const OAUTH_ACCESS_TOKEN_PREFIX = "lin_oauth_at_";

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

async function validateOAuthToken(
  headerList: Headers,
): Promise<ApiSession | null> {
  const token = readApiKeyToken(headerList);
  if (!token || !token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
    return null;
  }

  const tokenHash = createApiKeyHash(token);
  const workspaceRows = await db
    .select({ id: workspace.id, settings: workspace.settings })
    .from(workspace);
  const now = Date.now();
  const matched = workspaceRows
    .map((row) => ({
      workspaceId: row.id,
      api: readWorkspaceApiSettings(asRecord(row.settings)),
    }))
    .flatMap((row) =>
      row.api.oauthTokens.map((oauthToken) => ({
        workspaceId: row.workspaceId,
        oauthToken,
      })),
    )
    .find(
      ({ oauthToken }) =>
        oauthToken.tokenHash === tokenHash &&
        !oauthToken.revokedAt &&
        new Date(oauthToken.expiresAt).getTime() > now,
    );

  if (!matched) {
    return null;
  }

  const [record] = await db
    .select({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
      memberRole: member.role,
    })
    .from(user)
    .innerJoin(
      member,
      and(
        eq(member.userId, user.id),
        eq(member.workspaceId, matched.workspaceId),
      ),
    )
    .where(eq(user.id, matched.oauthToken.userId))
    .limit(1);

  if (!record) {
    return null;
  }

  return {
    user: {
      id: record.userId,
      name: record.userName,
      email: record.userEmail,
      image: record.userImage,
    },
    oauthToken: {
      id: matched.oauthToken.id,
      workspaceId: matched.workspaceId,
      applicationId: matched.oauthToken.applicationId,
      clientId: matched.oauthToken.clientId,
      scopes: matched.oauthToken.scopes,
    },
  };
}

export async function requireApiSession() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (session) {
    return { response: null, session: session as ApiSession };
  }

  const apiKeySession = await validateApiKey(requestHeaders);
  if (apiKeySession) {
    return { response: null, session: apiKeySession };
  }

  const oauthSession = await validateOAuthToken(requestHeaders);
  if (!oauthSession) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      session: null,
    };
  }

  return { response: null, session: oauthSession };
}
