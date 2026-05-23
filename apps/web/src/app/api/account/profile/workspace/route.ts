import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function DELETE() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const activeWorkspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!activeWorkspaceId) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  await db
    .delete(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.workspaceId, activeWorkspaceId),
      ),
    );

  const remainingMemberships = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, session.user.id))
    .orderBy(desc(member.createdAt))
    .limit(50);

  const nextWorkspaceId = remainingMemberships[0]?.workspaceId ?? null;
  const response = NextResponse.json({
    success: true,
    redirectTo: nextWorkspaceId ? "/" : "/create-workspace",
  });

  if (nextWorkspaceId) {
    response.cookies.set("activeWorkspaceId", nextWorkspaceId, {
      path: "/",
      sameSite: "lax",
    });
  } else {
    response.cookies.delete("activeWorkspaceId");
  }

  return response;
}
