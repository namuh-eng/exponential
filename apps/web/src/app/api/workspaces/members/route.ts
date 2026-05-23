import { readAccountProfileFromUserSettings } from "@/lib/account-profile";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { buildAppUrl, getRequestAppUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  member,
  memberRole,
  session,
  team,
  teamMember,
  user,
  workspace,
  workspaceInvitation,
} from "@/lib/db/schema";
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
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

type WorkspaceRole = (typeof memberRole.enumValues)[number];

function isManager(role: WorkspaceRole) {
  return role === "owner" || role === "admin";
}

async function getWorkspaceName(workspaceId: string) {
  const [workspaceRecord] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  return workspaceRecord?.name ?? "your workspace";
}

async function countWorkspaceOwners(workspaceId: string) {
  const ownerMemberships = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.workspaceId, workspaceId), eq(member.role, "owner")))
    .limit(2);

  return ownerMemberships.length;
}

async function getWorkspaceAccess(userId: string) {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const membership = await db
    .select({
      id: member.id,
      role: member.role,
      settings: workspace.settings,
    })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .where(and(eq(member.workspaceId, workspaceId), eq(member.userId, userId)))
    .limit(1);

  if (membership.length === 0) {
    return null;
  }

  return {
    workspaceId,
    membership: membership[0],
  };
}

export async function GET() {
  const requestHeaders = await headers();
  const authSession = await auth.api.getSession({ headers: requestHeaders });
  if (!authSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getWorkspaceAccess(authSession.user.id);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (headlessWorkspacesEnabled()) {
    const token = await mintInternalApiToken({
      userId: authSession.user.id,
      workspaceId: access.workspaceId,
    });
    const client = createHeadlessWorkspacesClient(token);
    const { data, error, response } = await client.GET("/workspaces/members");
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const activeMembers = await db
    .select({
      id: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
      joinedAt: member.createdAt,
      settings: user.settings,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.workspaceId, access.workspaceId))
    .orderBy(asc(user.name), asc(user.email));

  const userIds = activeMembers.map((entry) => entry.userId);

  const teamMemberships =
    userIds.length === 0
      ? []
      : await db
          .select({
            userId: teamMember.userId,
            teamName: team.name,
          })
          .from(teamMember)
          .innerJoin(team, eq(teamMember.teamId, team.id))
          .where(
            and(
              eq(team.workspaceId, access.workspaceId),
              inArray(teamMember.userId, userIds),
            ),
          )
          .orderBy(asc(team.name));

  const lastSeenRecords =
    userIds.length === 0
      ? []
      : await db
          .select({
            userId: session.userId,
            lastSeenAt: sql<string | null>`max(${session.updatedAt})`,
          })
          .from(session)
          .where(inArray(session.userId, userIds))
          .groupBy(session.userId);

  const pendingInvitations = await db
    .select({
      id: workspaceInvitation.id,
      email: workspaceInvitation.email,
      role: workspaceInvitation.role,
      createdAt: workspaceInvitation.createdAt,
    })
    .from(workspaceInvitation)
    .where(
      and(
        eq(workspaceInvitation.workspaceId, access.workspaceId),
        eq(workspaceInvitation.status, "pending"),
      ),
    )
    .orderBy(
      desc(workspaceInvitation.createdAt),
      asc(workspaceInvitation.email),
    );

  const teamsByUserId = new Map<string, string[]>();
  for (const teamMembership of teamMemberships) {
    teamsByUserId.set(teamMembership.userId, [
      ...(teamsByUserId.get(teamMembership.userId) ?? []),
      teamMembership.teamName,
    ]);
  }

  const lastSeenByUserId = new Map<string, string | null>();
  for (const lastSeen of lastSeenRecords) {
    lastSeenByUserId.set(lastSeen.userId, lastSeen.lastSeenAt);
  }

  const members = [
    ...activeMembers.map((entry) => {
      const profile = readAccountProfileFromUserSettings(entry.settings);
      return {
        id: entry.id,
        kind: "member" as const,
        userId: entry.userId,
        name: entry.name,
        email: entry.email,
        image: entry.image,
        role: entry.role,
        status: "active" as const,
        teams: teamsByUserId.get(entry.userId) ?? [],
        joinedAt: entry.joinedAt?.toISOString() ?? new Date(0).toISOString(),
        lastSeenAt: lastSeenByUserId.get(entry.userId) ?? null,
        pronouns: profile.pronouns,
        title: profile.title,
        location: profile.location,
        timezone: profile.timezone,
        showLocalTime: profile.showLocalTime,
      };
    }),
    ...pendingInvitations.map((entry) => ({
      id: entry.id,
      kind: "invitation" as const,
      userId: null,
      name: "Pending invite",
      email: entry.email,
      image: null,
      role: entry.role,
      status: "pending" as const,
      teams: [],
      joinedAt: entry.createdAt?.toISOString() ?? new Date(0).toISOString(),
      lastSeenAt: null,
    })),
  ];

  return NextResponse.json({
    workspaceId: access.workspaceId,
    currentUserId: authSession.user.id,
    viewerRole: access.membership.role,
    canInviteMembers: canPerformWorkspacePermission(
      access.membership.role,
      readWorkspacePermissionSettings(access.membership.settings)
        .invitationsRole,
    ),
    members,
  });
}

export async function PATCH(request: Request) {
  const requestHeaders = await headers();
  const authSession = await auth.api.getSession({ headers: requestHeaders });
  if (!authSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getWorkspaceAccess(authSession.user.id);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (!isManager(access.membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to manage members" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    kind?: "member" | "invitation";
    id?: string;
    role?: WorkspaceRole;
    action?: "resend";
  } | null;

  if (headlessWorkspacesEnabled()) {
    const token = await mintInternalApiToken({
      userId: authSession.user.id,
      workspaceId: access.workspaceId,
    });
    const client = createHeadlessWorkspacesClient(token);
    const { data, error, response } = await client.PATCH(
      "/workspaces/members",
      {
        body: body as never,
      },
    );
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  if (!body?.id || (body.kind !== "member" && body.kind !== "invitation")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (body.action && (body.kind !== "invitation" || body.action !== "resend")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (
    !body.action &&
    (!body.role || !memberRole.enumValues.includes(body.role))
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (body.kind === "member") {
    const targetMember = await db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
      })
      .from(member)
      .where(
        and(eq(member.id, body.id), eq(member.workspaceId, access.workspaceId)),
      )
      .limit(1);

    if (targetMember.length === 0) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const currentMember = targetMember[0];

    if (currentMember.userId === authSession.user.id) {
      return NextResponse.json(
        { error: "Use your account settings to change your own access" },
        { status: 400 },
      );
    }

    if (
      access.membership.role !== "owner" &&
      (currentMember.role === "owner" || body.role === "owner")
    ) {
      return NextResponse.json(
        { error: "Only owners can manage owner roles" },
        { status: 403 },
      );
    }

    if (currentMember.role === "owner" && body.role !== "owner") {
      if ((await countWorkspaceOwners(access.workspaceId)) < 2) {
        return NextResponse.json(
          { error: "Each workspace must keep at least one owner" },
          { status: 400 },
        );
      }
    }

    await db
      .update(member)
      .set({
        role: body.role as WorkspaceRole,
        updatedAt: new Date(),
      })
      .where(eq(member.id, currentMember.id));

    return NextResponse.json({ success: true });
  }

  const targetInvitation = await db
    .select({
      id: workspaceInvitation.id,
      email: workspaceInvitation.email,
      role: workspaceInvitation.role,
    })
    .from(workspaceInvitation)
    .where(
      and(
        eq(workspaceInvitation.id, body.id),
        eq(workspaceInvitation.workspaceId, access.workspaceId),
        eq(workspaceInvitation.status, "pending"),
      ),
    )
    .limit(1);

  if (targetInvitation.length === 0) {
    return NextResponse.json(
      { error: "Pending invitation not found" },
      { status: 404 },
    );
  }

  if (body.action === "resend") {
    const invitation = targetInvitation[0];
    const inviteToken = createInviteToken({
      workspaceId: access.workspaceId,
      email: invitation.email,
      role: invitation.role,
    });
    const inviteUrl = buildAppUrl(
      getRequestAppUrl(request),
      `/accept-invite?token=${encodeURIComponent(inviteToken)}`,
    );

    await sendInvitationEmail(
      invitation.email,
      await getWorkspaceName(access.workspaceId),
      authSession.user.name,
      inviteUrl,
    );
    await db
      .update(workspaceInvitation)
      .set({ token: inviteToken, updatedAt: new Date() })
      .where(eq(workspaceInvitation.id, invitation.id));

    return NextResponse.json({ success: true });
  }

  if (access.membership.role !== "owner" && body.role === "owner") {
    return NextResponse.json(
      { error: "Only owners can assign the owner role" },
      { status: 403 },
    );
  }

  await db
    .update(workspaceInvitation)
    .set({
      role: body.role as WorkspaceRole,
      updatedAt: new Date(),
    })
    .where(eq(workspaceInvitation.id, targetInvitation[0].id));

  return NextResponse.json({ success: true });
}

export async function POST(request: Request) {
  const requestHeaders = await headers();
  const authSession = await auth.api.getSession({ headers: requestHeaders });
  if (!authSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getWorkspaceAccess(authSession.user.id);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (!isManager(access.membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to manage members" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    kind?: "invitation";
    id?: string;
    action?: "resend";
  } | null;

  if (headlessWorkspacesEnabled()) {
    const token = await mintInternalApiToken({
      userId: authSession.user.id,
      workspaceId: access.workspaceId,
    });
    const client = createHeadlessWorkspacesClient(token);
    const { data, error, response } = await client.POST("/workspaces/members", {
      body: body as never,
    });
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  if (body?.kind !== "invitation" || !body.id || body.action !== "resend") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const targetInvitation = await db
    .select({
      id: workspaceInvitation.id,
      email: workspaceInvitation.email,
      role: workspaceInvitation.role,
      workspaceName: workspace.name,
    })
    .from(workspaceInvitation)
    .innerJoin(workspace, eq(workspace.id, workspaceInvitation.workspaceId))
    .where(
      and(
        eq(workspaceInvitation.id, body.id),
        eq(workspaceInvitation.workspaceId, access.workspaceId),
        eq(workspaceInvitation.status, "pending"),
      ),
    )
    .limit(1);

  if (targetInvitation.length === 0) {
    return NextResponse.json(
      { error: "Pending invitation not found" },
      { status: 404 },
    );
  }

  const invitation = targetInvitation[0];
  const inviteToken = createInviteToken({
    workspaceId: access.workspaceId,
    email: invitation.email,
    role: invitation.role,
  });
  const inviteUrl = buildAppUrl(
    getRequestAppUrl(request),
    `/accept-invite?token=${encodeURIComponent(inviteToken)}`,
  );

  await sendInvitationEmail(
    invitation.email,
    invitation.workspaceName,
    authSession.user.name,
    inviteUrl,
  );
  await db
    .update(workspaceInvitation)
    .set({ token: inviteToken, updatedAt: new Date() })
    .where(eq(workspaceInvitation.id, invitation.id));

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const requestHeaders = await headers();
  const authSession = await auth.api.getSession({ headers: requestHeaders });
  if (!authSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getWorkspaceAccess(authSession.user.id);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (!isManager(access.membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to manage members" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    kind?: "member" | "invitation";
    id?: string;
  } | null;

  if (headlessWorkspacesEnabled()) {
    const token = await mintInternalApiToken({
      userId: authSession.user.id,
      workspaceId: access.workspaceId,
    });
    const client = createHeadlessWorkspacesClient(token);
    const { data, error, response } = await client.DELETE(
      "/workspaces/members",
      {
        body: body as never,
      } as never,
    );
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  if (!body?.id || (body.kind !== "member" && body.kind !== "invitation")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (body.kind === "invitation") {
    const targetInvitation = await db
      .select({ id: workspaceInvitation.id })
      .from(workspaceInvitation)
      .where(
        and(
          eq(workspaceInvitation.id, body.id),
          eq(workspaceInvitation.workspaceId, access.workspaceId),
          eq(workspaceInvitation.status, "pending"),
        ),
      )
      .limit(1);

    if (targetInvitation.length === 0) {
      return NextResponse.json(
        { error: "Pending invitation not found" },
        { status: 404 },
      );
    }

    await db
      .update(workspaceInvitation)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(eq(workspaceInvitation.id, targetInvitation[0].id));

    return NextResponse.json({ success: true });
  }

  const targetMember = await db
    .select({
      id: member.id,
      userId: member.userId,
      role: member.role,
    })
    .from(member)
    .where(
      and(eq(member.id, body.id), eq(member.workspaceId, access.workspaceId)),
    )
    .limit(1);

  if (targetMember.length === 0) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const currentMember = targetMember[0];
  if (currentMember.userId === authSession.user.id) {
    return NextResponse.json(
      { error: "Use your account settings to leave this workspace" },
      { status: 400 },
    );
  }

  if (access.membership.role !== "owner" && currentMember.role === "owner") {
    return NextResponse.json(
      { error: "Only owners can remove owners" },
      { status: 403 },
    );
  }

  if (currentMember.role === "owner") {
    const ownerMemberships = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.workspaceId, access.workspaceId),
          eq(member.role, "owner"),
        ),
      )
      .limit(2);

    if (ownerMemberships.length < 2) {
      return NextResponse.json(
        { error: "Each workspace must keep at least one owner" },
        { status: 400 },
      );
    }
  }

  const workspaceTeams = await db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.workspaceId, access.workspaceId));
  const teamIds = workspaceTeams.map((entry) => entry.id);
  if (teamIds.length > 0) {
    await db
      .delete(teamMember)
      .where(
        and(
          eq(teamMember.userId, currentMember.userId),
          inArray(teamMember.teamId, teamIds),
        ),
      );
  }

  await db.delete(member).where(eq(member.id, currentMember.id));

  return NextResponse.json({ success: true });
}
