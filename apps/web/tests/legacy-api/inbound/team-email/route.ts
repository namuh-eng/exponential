import { db } from "@/lib/db";
import {
  issue,
  issueHistory,
  member,
  team,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import {
  createHeadlessInboundClient,
  headlessInboundEnabled,
} from "@/lib/headless-api";
import { normalizeIssueDescriptionHtml } from "@/lib/issue-description";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import {
  isInboundEmailRequestAuthorized,
  parseTeamInboundRecipient,
} from "@/lib/team-email";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

type InboundEmailPayload = {
  recipient?: unknown;
  to?: unknown;
  from?: unknown;
  sender?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (headlessInboundEnabled()) {
    const body = (await request
      .json()
      .catch(() => null)) as InboundEmailPayload | null;
    const client = createHeadlessInboundClient();
    const { data, error, response } = await client.POST("/inbound/team-email", {
      body: body as never,
      headers: {
        "x-inbound-email-secret":
          request.headers.get("x-inbound-email-secret") ?? "",
      },
    } as never);
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  if (!isInboundEmailRequestAuthorized(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request
    .json()
    .catch(() => null)) as InboundEmailPayload | null;
  const recipient = stringValue(body?.recipient) || stringValue(body?.to);
  const parsedRecipient = parseTeamInboundRecipient(recipient);

  if (!parsedRecipient) {
    return NextResponse.json(
      { error: "Unknown inbound email recipient" },
      { status: 404 },
    );
  }

  const teamQuery = db
    .select({
      id: team.id,
      key: team.key,
      workspaceId: team.workspaceId,
      settings: team.settings,
      workspaceSlug: workspace.urlSlug,
    })
    .from(team)
    .innerJoin(workspace, eq(team.workspaceId, workspace.id));

  const teamRows = await (parsedRecipient.workspaceSlug
    ? teamQuery
        .where(
          and(
            eq(team.key, parsedRecipient.teamKey),
            eq(workspace.urlSlug, parsedRecipient.workspaceSlug),
          ),
        )
        .limit(1)
    : teamQuery.where(eq(team.key, parsedRecipient.teamKey)).limit(1));

  const teamRecord = teamRows[0];
  if (!teamRecord) {
    return NextResponse.json(
      { error: "Unknown inbound email recipient" },
      { status: 404 },
    );
  }

  const settings =
    teamRecord.settings && typeof teamRecord.settings === "object"
      ? (teamRecord.settings as Record<string, unknown>)
      : {};

  if (settings.emailEnabled !== true) {
    return NextResponse.json(
      { error: "Inbound email is disabled for this team" },
      { status: 403 },
    );
  }

  const subject = stringValue(body?.subject) || "No subject";
  const rawDescription = stringValue(body?.html) || stringValue(body?.text);
  const sender = stringValue(body?.from) || stringValue(body?.sender) || null;

  const backlogStates = await db
    .select({
      id: workflowState.id,
      isDefault: workflowState.isDefault,
      position: workflowState.position,
    })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, teamRecord.id),
        eq(workflowState.category, "backlog"),
      ),
    )
    .limit(1000);
  const defaultState = backlogStates.sort(
    (a, b) =>
      Number(b.isDefault === true) - Number(a.isDefault === true) ||
      Number(a.position) - Number(b.position),
  )[0];

  if (!defaultState) {
    return NextResponse.json(
      { error: "No default workflow state found" },
      { status: 400 },
    );
  }

  const [creator] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.workspaceId, teamRecord.workspaceId))
    .limit(1);

  if (!creator) {
    return NextResponse.json(
      { error: "No workspace member can own inbound issue creation" },
      { status: 400 },
    );
  }

  const maxResult = await db
    .select({ maxNum: sql<number>`COALESCE(MAX(${issue.number}), 0)` })
    .from(issue)
    .where(eq(issue.teamId, teamRecord.id));

  const nextNumber = (maxResult[0]?.maxNum ?? 0) + 1;
  const identifier = `${teamRecord.key}-${nextNumber}`;
  const description = normalizeIssueDescriptionHtml(rawDescription);

  const createdIssue = await db.transaction(async (tx) => {
    const [newIssue] = await tx
      .insert(issue)
      .values({
        number: nextNumber,
        identifier,
        title: subject,
        description,
        teamId: teamRecord.id,
        stateId: defaultState.id,
        creatorId: creator.userId,
        priority: "none",
      })
      .returning();

    await insertIssueHistoryEvent(tx, teamRecord, {
      issueId: newIssue.id,
      actorId: creator.userId,
      actorName: sender,
      actorEmail: sender,
      eventType: "created",
      metadata: {
        identifier: newIssue.identifier,
        title: newIssue.title,
        teamId: teamRecord.id,
        source: "inbound_email",
        recipient,
        sender,
      },
    });

    return newIssue;
  });

  return NextResponse.json({ issue: createdIssue }, { status: 201 });
}
