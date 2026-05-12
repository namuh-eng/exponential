import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, user, workspace, workspaceInvitation } from "@/lib/db/schema";
import { sendInvitationEmail } from "@/lib/email";
import { createInviteToken } from "@/lib/invite-tokens";
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

  // Verify the user is a member of the workspace
  const membership = await db
    .select({ role: member.role })
    .from(member)
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

  if (!["owner", "admin"].includes(membership[0].role)) {
    return NextResponse.json(
      { error: "You do not have permission to invite members" },
      { status: 403 },
    );
  }

  // Get workspace info for the email
  const [ws] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
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
      const inviteUrl = `${baseUrl}/accept-invite?token=${encodeURIComponent(inviteToken)}`;
      await sendInvitationEmail(email, ws.name, session.user.name, inviteUrl);
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
