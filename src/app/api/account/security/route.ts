import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { account, session as sessionTable, user } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type AuthSession = {
  user: { id: string };
  session?: { id?: string | null } | null;
};

function getCurrentSessionId(authSession: AuthSession) {
  return typeof authSession.session?.id === "string"
    ? authSession.session.id
    : null;
}

async function currentUserExists(userId: string) {
  const [currentUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return Boolean(currentUser);
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const authSession = session as AuthSession;
  if (!(await currentUserExists(authSession.user.id))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const currentSessionId = getCurrentSessionId(authSession);

  const [sessions, providers] = await Promise.all([
    db
      .select({
        id: sessionTable.id,
        userAgent: sessionTable.userAgent,
        ipAddress: sessionTable.ipAddress,
        createdAt: sessionTable.createdAt,
        updatedAt: sessionTable.updatedAt,
        expiresAt: sessionTable.expiresAt,
      })
      .from(sessionTable)
      .where(eq(sessionTable.userId, authSession.user.id))
      .orderBy(desc(sessionTable.updatedAt)),
    db
      .select({
        id: account.id,
        providerId: account.providerId,
        accountId: account.accountId,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      })
      .from(account)
      .where(eq(account.userId, authSession.user.id))
      .orderBy(desc(account.updatedAt)),
  ]);

  return NextResponse.json({
    sessions: sessions.map((deviceSession) => ({
      ...deviceSession,
      isCurrent: currentSessionId
        ? deviceSession.id === currentSessionId
        : false,
    })),
    providers,
  });
}
