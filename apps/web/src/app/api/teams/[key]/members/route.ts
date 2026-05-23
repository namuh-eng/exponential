import { requireApiSession } from "@/lib/api-auth";
import { buildAppUrl, getRequestAppUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import {
  member,
  teamMember,
  user,
  workspace,
  workspaceInvitation,
} from "@/lib/db/schema";
import { sendInvitationEmail } from "@/lib/email";
import { createInviteToken, verifyInviteToken } from "@/lib/invite-tokens";
import { findAccessibleTeam } from "@/lib/teams";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

type TeamMembershipSession = NonNullable<
  Awaited<ReturnType<typeof requireApiSession>>["session"]
>;

function isManager(role: string | undefined) {
  return role === "owner" || role === "admin";
}

async function getWorkspaceRole(
  workspaceId: string,
  session: TeamMembershipSession,
) {
  if ("apiKey" in session && session.apiKey.workspaceId === workspaceId) {
    return session.apiKey.memberRole;
  }

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.workspaceId, workspaceId),
        eq(member.userId, session.user.id),
      ),
    )
    .limit(1);

  return membership?.role;
}

async function requireManageAccess(
  key: string,
  session: TeamMembershipSession,
  request: Request,
) {
  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });

  if (!teamRecord) {
    return {
      response: NextResponse.json({ error: "Team not found" }, { status: 404 }),
      teamRecord: null,
    };
  }

  const role = await getWorkspaceRole(teamRecord.workspaceId, session);
  if (!isManager(role)) {
    return {
      response: NextResponse.json(
        { error: "You do not have permission to manage team members" },
        { status: 403 },
      ),
      teamRecord: null,
    };
  }

  return { response: null, teamRecord };
}

function invitationTargetsTeam(token: string, teamKey: string) {
  return verifyInviteToken(token)?.teamKey === teamKey;
}

async function listMembers(teamRecord: {
  id: string;
  key: string;
  workspaceId: string;
}) {
  const activeMembers = await db
    .select({
      id: teamMember.id,
      kind: member.role,
      userId: teamMember.userId,
      name: user.name,
      email: user.email,
      role: member.role,
    })
    .from(teamMember)
    .innerJoin(user, eq(teamMember.userId, user.id))
    .innerJoin(
      member,
      and(
        eq(member.userId, teamMember.userId),
        eq(member.workspaceId, teamRecord.workspaceId),
      ),
    )
    .where(eq(teamMember.teamId, teamRecord.id))
    .orderBy(asc(user.name), asc(user.email));

  const pendingInvitations = await db
    .select({
      id: workspaceInvitation.id,
      email: workspaceInvitation.email,
      role: workspaceInvitation.role,
      token: workspaceInvitation.token,
      createdAt: workspaceInvitation.createdAt,
    })
    .from(workspaceInvitation)
    .where(
      and(
        eq(workspaceInvitation.workspaceId, teamRecord.workspaceId),
        eq(workspaceInvitation.status, "pending"),
      ),
    )
    .orderBy(
      desc(workspaceInvitation.createdAt),
      asc(workspaceInvitation.email),
    );

  return [
    ...activeMembers.map((entry) => ({
      id: entry.id,
      kind: "member" as const,
      userId: entry.userId,
      name: entry.name,
      email: entry.email,
      role: entry.role,
      status: "active" as const,
      actions: ["remove"] as const,
    })),
    ...pendingInvitations
      .filter((entry) => invitationTargetsTeam(entry.token, teamRecord.key))
      .map((entry) => ({
        id: entry.id,
        kind: "invitation" as const,
        userId: null,
        name: "Pending invite",
        email: entry.email,
        role: entry.role,
        status: "pending" as const,
        invitedAt: entry.createdAt?.toISOString() ?? null,
        actions: ["resend", "cancel"] as const,
      })),
  ];
}

async function getWorkspaceName(workspaceId: string) {
  const [workspaceRecord] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  return workspaceRecord?.name ?? "your workspace";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });

  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const members = await listMembers(teamRecord);

  return NextResponse.json({ members });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const access = await requireManageAccess(key, session, request);
  if (access.response) {
    return access.response;
  }
  const teamRecord = access.teamRecord;

  const body = (await request.json().catch(() => null)) as {
    userIds?: unknown;
    invitationIds?: unknown;
    inviteEmails?: unknown;
    role?: unknown;
  } | null;

  const userIds = Array.isArray(body?.userIds)
    ? [
        ...new Set(
          body.userIds.filter((id): id is string => typeof id === "string"),
        ),
      ]
    : [];
  const invitationIds = Array.isArray(body?.invitationIds)
    ? [
        ...new Set(
          body.invitationIds.filter(
            (id): id is string => typeof id === "string",
          ),
        ),
      ]
    : [];
  const inviteEmails = Array.isArray(body?.inviteEmails)
    ? [
        ...new Set(
          body.inviteEmails
            .filter((email): email is string => typeof email === "string")
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean),
        ),
      ]
    : [];
  const inviteRole =
    body?.role === "admin" || body?.role === "guest" || body?.role === "member"
      ? body.role
      : "member";

  if (
    userIds.length === 0 &&
    invitationIds.length === 0 &&
    inviteEmails.length === 0
  ) {
    return NextResponse.json(
      { error: "Select members or enter at least one email address" },
      { status: 400 },
    );
  }

  let userIdsToAdd: string[] = [];
  if (userIds.length > 0) {
    const workspaceUsers = await db
      .select({
        userId: member.userId,
      })
      .from(member)
      .where(
        and(
          eq(member.workspaceId, teamRecord.workspaceId),
          inArray(member.userId, userIds),
        ),
      );

    const workspaceUserIds = new Set(
      workspaceUsers.map((entry) => entry.userId),
    );
    const invalidUserIds = userIds.filter(
      (userId) => !workspaceUserIds.has(userId),
    );
    if (invalidUserIds.length > 0) {
      return NextResponse.json(
        { error: "Some users are not workspace members", invalidUserIds },
        { status: 400 },
      );
    }

    const existingMemberships = await db
      .select({ userId: teamMember.userId })
      .from(teamMember)
      .where(
        and(
          eq(teamMember.teamId, teamRecord.id),
          inArray(teamMember.userId, userIds),
        ),
      );
    const existingUserIds = new Set(
      existingMemberships.map((entry) => entry.userId),
    );
    userIdsToAdd = userIds.filter((userId) => !existingUserIds.has(userId));

    if (
      userIdsToAdd.length === 0 &&
      invitationIds.length === 0 &&
      inviteEmails.length === 0
    ) {
      return NextResponse.json(
        { error: "Selected users are already team members" },
        { status: 409 },
      );
    }

    if (userIdsToAdd.length > 0) {
      await db
        .insert(teamMember)
        .values(
          userIdsToAdd.map((userId) => ({
            teamId: teamRecord.id,
            userId,
          })),
        )
        .onConflictDoNothing();
    }
  }

  const baseUrl = getRequestAppUrl(request);
  const workspaceName = await getWorkspaceName(teamRecord.workspaceId);
  const updatedInvitationIds: string[] = [];

  if (invitationIds.length > 0) {
    const invitations = await db
      .select({
        id: workspaceInvitation.id,
        email: workspaceInvitation.email,
        role: workspaceInvitation.role,
      })
      .from(workspaceInvitation)
      .where(
        and(
          eq(workspaceInvitation.workspaceId, teamRecord.workspaceId),
          eq(workspaceInvitation.status, "pending"),
          inArray(workspaceInvitation.id, invitationIds),
        ),
      );
    const foundInvitationIds = new Set(invitations.map((entry) => entry.id));
    const invalidInvitationIds = invitationIds.filter(
      (id) => !foundInvitationIds.has(id),
    );
    if (invalidInvitationIds.length > 0) {
      return NextResponse.json(
        { error: "Some invitations were not found", invalidInvitationIds },
        { status: 400 },
      );
    }

    for (const invitation of invitations) {
      const inviteToken = createInviteToken({
        workspaceId: teamRecord.workspaceId,
        email: invitation.email,
        role: invitation.role,
        teamKey: teamRecord.key,
      });
      const inviteUrl = buildAppUrl(
        baseUrl,
        `/accept-invite?token=${encodeURIComponent(inviteToken)}`,
      );
      await sendInvitationEmail(
        invitation.email,
        workspaceName,
        session.user.name,
        inviteUrl,
      );
      await db
        .update(workspaceInvitation)
        .set({ token: inviteToken, updatedAt: new Date() })
        .where(eq(workspaceInvitation.id, invitation.id));
      updatedInvitationIds.push(invitation.id);
    }
  }

  const invitedEmails: string[] = [];
  for (const email of inviteEmails) {
    if (!email.includes("@")) {
      return NextResponse.json(
        { error: "Enter a valid email address" },
        { status: 400 },
      );
    }

    const existingMember = await db
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(
          eq(member.workspaceId, teamRecord.workspaceId),
          eq(user.email, email),
        ),
      )
      .limit(1);
    if (existingMember.length > 0) {
      return NextResponse.json(
        { error: "This person is already a workspace member" },
        { status: 409 },
      );
    }

    const inviteToken = createInviteToken({
      workspaceId: teamRecord.workspaceId,
      email,
      role: inviteRole,
      teamKey: teamRecord.key,
    });
    const inviteUrl = buildAppUrl(
      baseUrl,
      `/accept-invite?token=${encodeURIComponent(inviteToken)}`,
    );
    await sendInvitationEmail(
      email,
      workspaceName,
      session.user.name,
      inviteUrl,
    );
    await db
      .insert(workspaceInvitation)
      .values({
        workspaceId: teamRecord.workspaceId,
        email,
        role: inviteRole,
        invitedByUserId: session.user.id,
        token: inviteToken,
        status: "pending",
        acceptedAt: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workspaceInvitation.workspaceId, workspaceInvitation.email],
        set: {
          role: inviteRole,
          invitedByUserId: session.user.id,
          token: inviteToken,
          status: "pending",
          acceptedAt: null,
          updatedAt: new Date(),
        },
      });
    invitedEmails.push(email);
  }

  return NextResponse.json({
    success: true,
    addedUserIds: userIdsToAdd,
    updatedInvitationIds,
    invitedEmails,
    members: await listMembers(teamRecord),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const access = await requireManageAccess(key, session, request);
  if (access.response) {
    return access.response;
  }
  const teamRecord = access.teamRecord;
  const body = (await request.json().catch(() => null)) as {
    invitationId?: unknown;
    action?: unknown;
  } | null;

  if (typeof body?.invitationId !== "string" || body.action !== "resend") {
    return NextResponse.json(
      { error: "Invalid invitation action" },
      { status: 400 },
    );
  }

  const [invitation] = await db
    .select({
      id: workspaceInvitation.id,
      email: workspaceInvitation.email,
      role: workspaceInvitation.role,
      token: workspaceInvitation.token,
    })
    .from(workspaceInvitation)
    .where(
      and(
        eq(workspaceInvitation.id, body.invitationId),
        eq(workspaceInvitation.workspaceId, teamRecord.workspaceId),
        eq(workspaceInvitation.status, "pending"),
      ),
    )
    .limit(1);

  if (!invitation || !invitationTargetsTeam(invitation.token, teamRecord.key)) {
    return NextResponse.json(
      { error: "Pending invitation not found" },
      { status: 404 },
    );
  }

  const inviteToken = createInviteToken({
    workspaceId: teamRecord.workspaceId,
    email: invitation.email,
    role: invitation.role,
    teamKey: teamRecord.key,
  });
  const inviteUrl = buildAppUrl(
    getRequestAppUrl(request),
    `/accept-invite?token=${encodeURIComponent(inviteToken)}`,
  );
  await sendInvitationEmail(
    invitation.email,
    await getWorkspaceName(teamRecord.workspaceId),
    session.user.name,
    inviteUrl,
  );
  await db
    .update(workspaceInvitation)
    .set({ token: inviteToken, updatedAt: new Date() })
    .where(eq(workspaceInvitation.id, invitation.id));

  return NextResponse.json({
    success: true,
    members: await listMembers(teamRecord),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const access = await requireManageAccess(key, session, request);
  if (access.response) {
    return access.response;
  }
  const teamRecord = access.teamRecord;

  const body = (await request.json().catch(() => null)) as {
    userId?: unknown;
    invitationId?: unknown;
  } | null;
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const invitationId =
    typeof body?.invitationId === "string" ? body.invitationId : "";

  if (!userId && !invitationId) {
    return NextResponse.json(
      { error: "User ID or invitation ID is required" },
      { status: 400 },
    );
  }

  if (invitationId) {
    const [invitation] = await db
      .select({ id: workspaceInvitation.id, token: workspaceInvitation.token })
      .from(workspaceInvitation)
      .where(
        and(
          eq(workspaceInvitation.id, invitationId),
          eq(workspaceInvitation.workspaceId, teamRecord.workspaceId),
          eq(workspaceInvitation.status, "pending"),
        ),
      )
      .limit(1);

    if (
      !invitation ||
      !invitationTargetsTeam(invitation.token, teamRecord.key)
    ) {
      return NextResponse.json(
        { error: "Pending invitation not found" },
        { status: 404 },
      );
    }

    await db
      .update(workspaceInvitation)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(eq(workspaceInvitation.id, invitation.id));

    return NextResponse.json({
      success: true,
      removedInvitationId: invitation.id,
      members: await listMembers(teamRecord),
    });
  }

  const memberships = await db
    .select({ id: teamMember.id, userId: teamMember.userId })
    .from(teamMember)
    .where(eq(teamMember.teamId, teamRecord.id));

  const targetMembership = memberships.find((entry) => entry.userId === userId);
  if (!targetMembership) {
    return NextResponse.json(
      { error: "User is not a member of this team" },
      { status: 404 },
    );
  }

  if (memberships.length <= 1) {
    return NextResponse.json(
      { error: "Teams must keep at least one member" },
      { status: 400 },
    );
  }

  await db.delete(teamMember).where(eq(teamMember.id, targetMembership.id));

  return NextResponse.json({
    success: true,
    removedUserId: userId,
    members: await listMembers(teamRecord),
  });
}
