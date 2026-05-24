import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member } from "@/lib/db/schema";
import {
  createHeadlessAccountWorkspaceLeaveClient,
  headlessAccountWorkspaceLeaveEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
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

  if (headlessAccountWorkspaceLeaveEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: activeWorkspaceId,
    });
    const client = createHeadlessAccountWorkspaceLeaveClient(token);
    const { data, error, response } = await client.DELETE(
      "/account/profile/workspace",
    );
    const headers = new Headers();
    const setCookie = (response as Response).headers.get("set-cookie");
    if (setCookie) {
      headers.set("set-cookie", setCookie);
    }
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
        headers,
      });
    }
    return NextResponse.json(data, {
      status: (response as Response).status,
      headers,
    });
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
