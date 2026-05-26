import { requireApiSession } from "@/lib/api-auth";
import { buildAppUrl, getRequestAppUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import { member, user, workspace, workspaceInvitation } from "@/lib/db/schema";
import { sendInvitationEmail } from "@/lib/email";
import { createInviteToken } from "@/lib/invite-tokens";
import {
  canPerformWorkspacePermission,
  readWorkspacePermissionSettings,
} from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const body = await request.json();
  const auth = await requireApiSession();
  const ownerEmail = String(body.ownerEmail ?? "")
    .trim()
    .toLowerCase();
  const session = auth.session;
  const invites = (body.invites ?? []) as {
    email: string;
    role?: "admin" | "member" | "guest";
  }[];
  if (!invites.length)
    return NextResponse.json(
      { error: "At least one invite is required" },
      { status: 400 },
    );
  const membership = await db
    .select({
      role: member.role,
      ownerUserId: member.userId,
      workspaceName: workspace.name,
      settings: workspace.settings,
    })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .where(
      and(
        session ? eq(member.userId, session.user.id) : eq(member.role, "owner"),
        eq(member.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (
    membership.length === 0 ||
    (!session &&
      ownerEmail !==
        ((membership[0].settings ?? {}) as { signupOwnerEmail?: string })
          .signupOwnerEmail)
  )
    return NextResponse.json(
      { error: "You are not a member of this workspace" },
      { status: 403 },
    );
  const settings = (membership[0].settings ?? {}) as {
    signupEmailVerified?: boolean;
  };
  if (settings.signupEmailVerified !== true)
    return NextResponse.json(
      { error: "Verify your email before sending invites" },
      { status: 403 },
    );
  const invitePermission = readWorkspacePermissionSettings(
    membership[0].settings,
  ).invitationsRole;
  if (
    session &&
    !canPerformWorkspacePermission(membership[0].role, invitePermission)
  )
    return NextResponse.json(
      { error: "You do not have permission to invite members" },
      { status: 403 },
    );
  const baseUrl = getRequestAppUrl(request);
  const results: {
    email: string;
    status: "sent" | "failed";
    error?: string;
  }[] = [];
  for (const invite of invites) {
    const email = invite.email?.trim().toLowerCase();
    const role = invite.role ?? "member";
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
      const inviteToken = createInviteToken({ workspaceId, email, role });
      const inviteUrl = buildAppUrl(
        baseUrl,
        `/accept-invite?token=${encodeURIComponent(inviteToken)}`,
      );
      await sendInvitationEmail(
        email,
        membership[0].workspaceName,
        session?.user.name ?? ownerEmail,
        inviteUrl,
      );
      await db
        .insert(workspaceInvitation)
        .values({
          workspaceId,
          email,
          role,
          invitedByUserId:
            session?.user.id ??
            (membership[0] as { ownerUserId?: string }).ownerUserId ??
            `signup-${ownerEmail}`,
          token: inviteToken,
          status: "pending",
          acceptedAt: null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [workspaceInvitation.workspaceId, workspaceInvitation.email],
          set: {
            role,
            invitedByUserId:
              session?.user.id ??
              (membership[0] as { ownerUserId?: string }).ownerUserId ??
              `signup-${ownerEmail}`,
            token: inviteToken,
            status: "pending",
            acceptedAt: null,
            updatedAt: new Date(),
          },
        });
      results.push({ email, status: "sent" });
    } catch (error) {
      results.push({
        email,
        status: "failed",
        error: error instanceof Error ? error.message : "Failed to send email",
      });
    }
  }
  return NextResponse.json({
    results,
    shareLink: buildAppUrl(
      baseUrl,
      `/accept-invite?workspace=${encodeURIComponent(workspaceId)}`,
    ),
  });
}
