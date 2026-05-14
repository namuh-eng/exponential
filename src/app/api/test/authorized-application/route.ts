import { randomBytes } from "node:crypto";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { authorizedApplicationGrant } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type AuthSession = {
  user: { id: string };
};

function createId(prefix: string) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export async function POST(request: Request) {
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.PLAYWRIGHT_TEST !== "true"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const authSession = session as AuthSession;
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    name?: string;
    scopes?: string[];
  } | null;

  if (body?.action === "clear") {
    await db
      .delete(authorizedApplicationGrant)
      .where(eq(authorizedApplicationGrant.userId, authSession.user.id));
    return NextResponse.json({ success: true });
  }

  const id = createId("grant");
  const appId = createId("app");
  const clientId = `lin_${randomBytes(12).toString("hex")}`;
  const name = body?.name?.trim() || "E2E OAuth App";
  const scopes = Array.isArray(body?.scopes) ? body.scopes : ["read", "write"];

  await db.insert(authorizedApplicationGrant).values({
    id,
    userId: authSession.user.id,
    appId,
    clientId,
    name,
    imageUrl: null,
    scopes,
    webhooksEnabled: true,
  });

  return NextResponse.json(
    {
      id,
      appId,
      clientId,
      name,
      scopes,
      webhooksEnabled: true,
    },
    { status: 201 },
  );
}

export async function DELETE() {
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.PLAYWRIGHT_TEST !== "true"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const authSession = session as AuthSession;
  await db
    .delete(authorizedApplicationGrant)
    .where(eq(authorizedApplicationGrant.userId, authSession.user.id));

  return NextResponse.json({ success: true });
}
