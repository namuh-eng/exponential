import {
  CANONICAL_TEAM_KEY,
  CANONICAL_TEAM_NAME,
  CANONICAL_WORKSPACE_NAME,
  CANONICAL_WORKSPACE_SLUG,
} from "@/lib/canonical-routes";
import { db } from "@/lib/db";
import {
  issue,
  member,
  notification,
  team,
  teamMember,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import { getDefaultWorkflowStates } from "@/lib/workspace-creation";
import { and, eq } from "drizzle-orm";

const CANONICAL_NOTIFICATION_ACTOR = {
  id: "canonical-notification-actor",
  email: "notifications@foreverbrowsing.test",
  name: "Ashley Ha",
};

const CANONICAL_INBOX_HISTORY = [
  {
    number: 179,
    identifier: "ENG-179",
    title: "Issue added to FOREVER-AGENT",
    priority: "medium" as const,
    type: "status_change" as const,
    createdAt: new Date("2026-05-06T17:30:00.000Z"),
  },
  {
    number: 138,
    identifier: "ENG-138",
    title: "Figure out latest strategy for browser session memory",
    priority: "high" as const,
    type: "assigned" as const,
    createdAt: new Date("2026-05-02T20:15:00.000Z"),
  },
  {
    number: 137,
    identifier: "ENG-137",
    title: "Audit autonomous navigation edge cases",
    priority: "high" as const,
    type: "assigned" as const,
    createdAt: new Date("2026-05-02T19:45:00.000Z"),
  },
  {
    number: 136,
    identifier: "ENG-136",
    title: "Improve Forever Browsing agent inbox handoff",
    priority: "medium" as const,
    type: "assigned" as const,
    createdAt: new Date("2026-05-02T19:00:00.000Z"),
  },
];

async function ensureCanonicalNotificationActor() {
  const [existingActor] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, CANONICAL_NOTIFICATION_ACTOR.email))
    .limit(1);

  if (existingActor) {
    return existingActor.id;
  }

  const [createdActor] = await db
    .insert(user)
    .values({
      ...CANONICAL_NOTIFICATION_ACTOR,
      emailVerified: true,
    })
    .returning({ id: user.id });

  return createdActor.id;
}

async function ensureCanonicalInboxHistory(input: {
  actorId: string;
  stateId: string;
  teamId: string;
  userId: string;
}) {
  for (const item of CANONICAL_INBOX_HISTORY) {
    let [issueRecord] = await db
      .select({ id: issue.id })
      .from(issue)
      .where(and(eq(issue.teamId, input.teamId), eq(issue.number, item.number)))
      .limit(1);

    if (!issueRecord) {
      [issueRecord] = await db
        .insert(issue)
        .values({
          number: item.number,
          identifier: item.identifier,
          title: item.title,
          description: "Canonical Forever Browsing inbox history seed.",
          teamId: input.teamId,
          stateId: input.stateId,
          assigneeId: input.userId,
          creatorId: input.actorId,
          priority: item.priority,
          createdAt: item.createdAt,
          updatedAt: item.createdAt,
        })
        .returning({ id: issue.id });
    }

    const [existingNotification] = await db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.userId, input.userId),
          eq(notification.issueId, issueRecord.id),
          eq(notification.type, item.type),
        ),
      )
      .limit(1);

    if (existingNotification) {
      continue;
    }

    await db.insert(notification).values({
      userId: input.userId,
      issueId: issueRecord.id,
      actorId: input.actorId,
      type: item.type,
      readAt: new Date(item.createdAt.getTime() + 60 * 60 * 1000),
      createdAt: item.createdAt,
    });
  }
}

export async function ensureCanonicalWorkspaceForUser(userId: string) {
  let [workspaceRecord] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      urlSlug: workspace.urlSlug,
    })
    .from(workspace)
    .where(eq(workspace.urlSlug, CANONICAL_WORKSPACE_SLUG))
    .limit(1);

  if (!workspaceRecord) {
    [workspaceRecord] = await db
      .insert(workspace)
      .values({
        name: CANONICAL_WORKSPACE_NAME,
        urlSlug: CANONICAL_WORKSPACE_SLUG,
        settings: {
          region: "United States",
          fiscalMonth: "january",
        },
      })
      .returning({
        id: workspace.id,
        name: workspace.name,
        urlSlug: workspace.urlSlug,
      });
  }

  const [existingMember] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.workspaceId, workspaceRecord.id),
        eq(member.userId, userId),
      ),
    )
    .limit(1);

  if (!existingMember) {
    await db.insert(member).values({
      userId,
      workspaceId: workspaceRecord.id,
      role: "owner",
    });
  }

  let [teamRecord] = await db
    .select({ id: team.id, name: team.name, key: team.key })
    .from(team)
    .where(
      and(
        eq(team.workspaceId, workspaceRecord.id),
        eq(team.key, CANONICAL_TEAM_KEY),
      ),
    )
    .limit(1);

  if (!teamRecord) {
    [teamRecord] = await db
      .insert(team)
      .values({
        name: CANONICAL_TEAM_NAME,
        key: CANONICAL_TEAM_KEY,
        workspaceId: workspaceRecord.id,
        cyclesEnabled: true,
        cycleStartDay: 1,
        cycleDurationWeeks: 2,
      })
      .returning({ id: team.id, name: team.name, key: team.key });
  }

  const [existingTeamMember] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(
      and(eq(teamMember.teamId, teamRecord.id), eq(teamMember.userId, userId)),
    )
    .limit(1);

  if (!existingTeamMember) {
    await db.insert(teamMember).values({
      teamId: teamRecord.id,
      userId,
    });
  }

  let [existingWorkflowState] = await db
    .select({ id: workflowState.id })
    .from(workflowState)
    .where(eq(workflowState.teamId, teamRecord.id))
    .limit(1);

  if (!existingWorkflowState) {
    [existingWorkflowState] = await db
      .insert(workflowState)
      .values(getDefaultWorkflowStates(teamRecord.id))
      .returning({ id: workflowState.id });
  }

  const actorId = await ensureCanonicalNotificationActor();
  await ensureCanonicalInboxHistory({
    actorId,
    stateId: existingWorkflowState.id,
    teamId: teamRecord.id,
    userId,
  });

  return { workspace: workspaceRecord, team: teamRecord };
}
