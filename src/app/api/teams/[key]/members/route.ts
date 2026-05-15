import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, teamMember, user } from "@/lib/db/schema";
import { findAccessibleTeam } from "@/lib/teams";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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

async function listMembers(teamId: string) {
  return db
    .select({
      id: teamMember.id,
      userId: teamMember.userId,
      name: user.name,
      email: user.email,
      role: sql<string>`'member'`,
    })
    .from(teamMember)
    .innerJoin(user, eq(teamMember.userId, user.id))
    .where(eq(teamMember.teamId, teamId))
    .orderBy(asc(user.name), asc(user.email));
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

  const members = await listMembers(teamRecord.id);

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
  } | null;

  const userIds = Array.isArray(body?.userIds)
    ? [
        ...new Set(
          body.userIds.filter((id): id is string => typeof id === "string"),
        ),
      ]
    : [];

  if (userIds.length === 0) {
    return NextResponse.json(
      { error: "At least one user ID is required" },
      { status: 400 },
    );
  }

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

  const workspaceUserIds = new Set(workspaceUsers.map((entry) => entry.userId));
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
  const userIdsToAdd = userIds.filter((userId) => !existingUserIds.has(userId));

  if (userIdsToAdd.length === 0) {
    return NextResponse.json(
      { error: "Selected users are already team members" },
      { status: 409 },
    );
  }

  await db
    .insert(teamMember)
    .values(
      userIdsToAdd.map((userId) => ({
        teamId: teamRecord.id,
        userId,
      })),
    )
    .onConflictDoNothing();

  return NextResponse.json({
    success: true,
    addedUserIds: userIdsToAdd,
    members: await listMembers(teamRecord.id),
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
  } | null;
  const userId = typeof body?.userId === "string" ? body.userId : "";

  if (!userId) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
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
    members: await listMembers(teamRecord.id),
  });
}
