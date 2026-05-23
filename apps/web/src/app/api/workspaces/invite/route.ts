import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { buildAppUrl, getRequestAppUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import { member, user, workspace, workspaceInvitation } from "@/lib/db/schema";
import { sendInvitationEmail } from "@/lib/email";
import {
  createHeadlessWorkspacesClient,
  headlessWorkspacesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { createInviteToken } from "@/lib/invite-tokens";
import {
  canPerformWorkspacePermission,
  readWorkspacePermissionSettings,
} from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

interface InviteRequest {
  workspaceId: string;
  invites: {
    email: string;
    role: "admin" | "member" | "guest";
  }[];
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const body = (await request.json()) as InviteRequest;
  const workspaceId =
    body.workspaceId || (await resolveActiveWorkspaceId(session.user.id));
  const { invites } = body;

  if (!workspaceId || !invites?.length) {
    return NextResponse.json(
      { error: "Workspace ID and at least one invite are required" },
      { status: 400 },
    );
  }

  if (headlessWorkspacesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessWorkspacesClient(token);
    const { data, error, response } = await client.POST("/workspaces/invite", {
      body: body as never,
    });
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  // Verify the user is a member of the workspace and load security policy.
  const membership = await db
    .select({
      role: member.role,
      workspaceName: workspace.name,
      settings: workspace.settings,
    })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (membership.length === 0) {
    return NextResponse.json(
      { error: "You are not a member of this workspace" },
      { status: 403 },
    );
  }

  const invitePermission = readWorkspacePermissionSettings(
    membership[0].settings,
  ).invitationsRole;
  if (!canPerformWorkspacePermission(membership[0].role, invitePermission)) {
    return NextResponse.json(
      { error: "You do not have permission to invite members" },
      { status: 403 },
    );
  }

  const baseUrl = getRequestAppUrl(request);
  const results: {
    email: string;
    status: "sent" | "failed";
    error?: string;
  }[] = [];

  for (const invite of invites) {
    const email = invite.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      results.push({
        email: invite.email,
        status: "failed",
        error: "Invalid email",
      });
      continue;
    }

    const existingMember = await db
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(and(eq(member.workspaceId, workspaceId), eq(user.email, email)))
      .limit(1);

    if (existingMember.length > 0) {
      results.push({
        email,
        status: "failed",
        error: "This person is already a workspace member",
      });
      continue;
    }

    try {
      const inviteToken = createInviteToken({
        workspaceId,
        email,
        role: invite.role,
      });
      const inviteUrl = buildAppUrl(
        baseUrl,
        `/accept-invite?token=${encodeURIComponent(inviteToken)}`,
      );
      await sendInvitationEmail(
        email,
        membership[0].workspaceName,
        session.user.name,
        inviteUrl,
      );
      await db
        .insert(workspaceInvitation)
        .values({
          workspaceId,
          email,
          role: invite.role,
          invitedByUserId: session.user.id,
          token: inviteToken,
          status: "pending",
          acceptedAt: null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [workspaceInvitation.workspaceId, workspaceInvitation.email],
          set: {
            role: invite.role,
            invitedByUserId: session.user.id,
            token: inviteToken,
            status: "pending",
            acceptedAt: null,
            updatedAt: new Date(),
          },
        });
      results.push({ email, status: "sent" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send email";
      results.push({ email, status: "failed", error: message });
    }
  }

  return NextResponse.json({ results });
}
