import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  member,
  team,
  teamMember,
  workspace,
  workspaceInvitation,
} from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/invite-tokens";
import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function InviteError({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090909] px-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-[#26262a] bg-[#111113] p-8 text-center">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-white">
          {title}
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[#9095a1]">
          {description}
        </p>
      </div>
    </div>
  );
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <InviteError
        title="Invitation unavailable"
        description="This invite link is missing required information."
      />
    );
  }

  const signedInvite = verifyInviteToken(token);
  const [storedInvite] = await db
    .select({
      id: workspaceInvitation.id,
      workspaceId: workspaceInvitation.workspaceId,
      email: workspaceInvitation.email,
      role: workspaceInvitation.role,
      status: workspaceInvitation.status,
      token: workspaceInvitation.token,
    })
    .from(workspaceInvitation)
    .where(eq(workspaceInvitation.token, token))
    .limit(1);
  const [workspaceInviteLink] = await db
    .select({
      workspaceId: workspace.id,
      inviteLinkEnabled: workspace.inviteLinkEnabled,
    })
    .from(workspace)
    .where(eq(workspace.inviteLinkToken, token))
    .limit(1);

  const storedInvitePayload = storedInvite
    ? verifyInviteToken(storedInvite.token)
    : null;
  const invite = storedInvite
    ? storedInvite.status === "pending"
      ? {
          id: storedInvite.id,
          workspaceId: storedInvite.workspaceId,
          email: storedInvite.email,
          role: storedInvite.role,
          teamKey: storedInvitePayload?.teamKey ?? null,
        }
      : null
    : signedInvite
      ? {
          id: null,
          workspaceId: signedInvite.workspaceId,
          email: signedInvite.email,
          role: signedInvite.role,
          teamKey: signedInvite.teamKey ?? null,
        }
      : workspaceInviteLink?.inviteLinkEnabled
        ? {
            id: null,
            workspaceId: workspaceInviteLink.workspaceId,
            email: null,
            role: "member" as const,
            teamKey: null,
          }
        : null;

  if (!invite) {
    return (
      <InviteError
        title="Invitation expired"
        description="This invite link is invalid or has expired. Ask your teammate to send a new invite."
      />
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/accept-invite?token=${token}`)}`,
    );
  }

  if (
    invite.email &&
    session.user.email.trim().toLowerCase() !== invite.email
  ) {
    return (
      <InviteError
        title="Wrong account"
        description={`This invitation is for ${invite.email}. Sign in with that email address to join the workspace.`}
      />
    );
  }

  const [workspaceRecord] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.id, invite.workspaceId))
    .limit(1);

  if (!workspaceRecord) {
    return (
      <InviteError
        title="Workspace not found"
        description="This workspace no longer exists."
      />
    );
  }

  const [defaultTeam] = await db
    .select({ id: team.id, key: team.key })
    .from(team)
    .where(
      invite.teamKey
        ? and(
            eq(team.workspaceId, invite.workspaceId),
            eq(team.key, invite.teamKey),
          )
        : eq(team.workspaceId, invite.workspaceId),
    )
    .orderBy(asc(team.createdAt))
    .limit(1);

  if (!defaultTeam) {
    return (
      <InviteError
        title="Workspace unavailable"
        description="The workspace does not have a team to join yet."
      />
    );
  }

  const existingMembership = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.workspaceId, invite.workspaceId),
      ),
    )
    .limit(1);

  if (existingMembership.length === 0) {
    await db.insert(member).values({
      userId: session.user.id,
      workspaceId: invite.workspaceId,
      role: invite.role,
    });
  }

  await db
    .insert(teamMember)
    .values({ teamId: defaultTeam.id, userId: session.user.id })
    .onConflictDoNothing();

  if (invite.id) {
    await db
      .update(workspaceInvitation)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workspaceInvitation.id, invite.id));
  }

  redirect(`/team/${defaultTeam.key}/all`);
}
