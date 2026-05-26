import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { authorizedApplicationGrant, member, workspace } from "@/lib/db/schema";
import {
  createHeadlessWorkspacesClient,
  headlessWorkspacesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type WorkspaceMemberRole = "owner" | "admin" | "member" | "guest";

type Params = { params: Promise<{ id: string }> | { id: string } };

function canManageApplications(role: WorkspaceMemberRole) {
  return role === "owner" || role === "admin";
}

async function getAccess(userId: string, workspaceIdOverride?: string) {
  const workspaceId =
    workspaceIdOverride ?? (await resolveActiveWorkspaceId(userId));
  if (!workspaceId) return null;
  const [access] = await db
    .select({ workspaceId: workspace.id, memberRole: member.role })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.workspaceId, workspaceId),
        eq(member.userId, userId),
      ),
    )
    .limit(1);
  return access ?? null;
}

export async function DELETE(_request: Request, context: Params) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  if (headlessWorkspacesEnabled()) {
    const workspaceId =
      "apiKey" in session
        ? session.apiKey.workspaceId
        : await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const { id } = await context.params;
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.DELETE(
        "/workspaces/current/applications/{id}",
        { params: { path: { id } } },
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const access = await getAccess(
    session.user.id,
    "apiKey" in session ? session.apiKey.workspaceId : undefined,
  );
  if (!access)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  if (!canManageApplications(access.memberRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id)
    return NextResponse.json(
      { error: "Application id is required." },
      { status: 400 },
    );

  const [grant] = await db
    .select({ id: authorizedApplicationGrant.id })
    .from(authorizedApplicationGrant)
    .innerJoin(
      member,
      and(
        eq(member.userId, authorizedApplicationGrant.userId),
        eq(member.workspaceId, authorizedApplicationGrant.workspaceId),
      ),
    )
    .where(
      and(
        eq(authorizedApplicationGrant.workspaceId, access.workspaceId),
        eq(authorizedApplicationGrant.id, id),
      ),
    )
    .limit(1);

  if (!grant)
    return NextResponse.json(
      { error: "Application not found" },
      { status: 404 },
    );

  await db
    .delete(authorizedApplicationGrant)
    .where(eq(authorizedApplicationGrant.id, id));
  return NextResponse.json({ success: true });
}
