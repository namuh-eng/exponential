import { requireApiSession } from "@/lib/api-auth";
import { cycleRangesOverlap, parseCycleDateInput } from "@/lib/cycle-utils";
import { db } from "@/lib/db";
import { cycle, issue, workflowState } from "@/lib/db/schema";
import {
  createHeadlessTeamsClient,
  headlessTeamsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { findAccessibleTeam } from "@/lib/teams";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

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

  if (headlessTeamsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const client = createHeadlessTeamsClient(token);
    const { data, error, response } = await client.GET("/teams/{key}/cycles", {
      params: { path: { key } },
    });
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const hierarchyTeamIds = teamRecord.hierarchyTeamIds ?? [teamRecord.id];

  // Get all cycles for this team hierarchy
  const cycles = await db
    .select()
    .from(cycle)
    .where(inArray(cycle.teamId, hierarchyTeamIds))
    .orderBy(desc(cycle.startDate));

  // Get issue counts per cycle (total and completed)
  const completedStates = await db
    .select({ id: workflowState.id })
    .from(workflowState)
    .where(
      and(
        inArray(workflowState.teamId, hierarchyTeamIds),
        eq(workflowState.category, "completed"),
      ),
    );
  const completedStateIds = completedStates.map((s) => s.id);

  const cyclesWithCounts = await Promise.all(
    cycles.map(async (c) => {
      const totalResult = await db
        .select({ value: count() })
        .from(issue)
        .where(
          and(eq(issue.cycleId, c.id), inArray(issue.teamId, hierarchyTeamIds)),
        );
      const issueCount = totalResult[0]?.value ?? 0;

      let completedIssueCount = 0;
      if (completedStateIds.length > 0 && issueCount > 0) {
        const completedResult = await db
          .select({ value: count() })
          .from(issue)
          .where(
            and(
              eq(issue.cycleId, c.id),
              inArray(issue.teamId, hierarchyTeamIds),
              sql`${issue.stateId} IN (${sql.join(
                completedStateIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            ),
          );
        completedIssueCount = completedResult[0]?.value ?? 0;
      }

      return {
        id: c.id,
        name: c.name,
        number: c.number,
        teamId: c.teamId,
        startDate: c.startDate,
        endDate: c.endDate,
        autoRollover: c.autoRollover,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        issueCount,
        completedIssueCount,
      };
    }),
  );

  return NextResponse.json({
    team: {
      id: teamRecord.id,
      name: teamRecord.name,
      key: teamRecord.key,
      cyclesEnabled: teamRecord.cyclesEnabled ?? false,
      cycleStartDay: teamRecord.cycleStartDay ?? 1,
      cycleDurationWeeks: teamRecord.cycleDurationWeeks ?? 2,
      timezone: teamRecord.timezone ?? "",
    },
    cycles: cyclesWithCounts,
  });
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

  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const teamId = teamRecord.id;

  const body = await request.json();

  if (headlessTeamsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const client = createHeadlessTeamsClient(token);
    const { data, error, response } = await client.POST("/teams/{key}/cycles", {
      params: { path: { key } },
      body: body as never,
    });
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }
  const startDate =
    typeof body.startDate === "string"
      ? parseCycleDateInput(body.startDate)
      : null;
  const endDate =
    typeof body.endDate === "string" ? parseCycleDateInput(body.endDate) : null;

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "Start and end dates must use YYYY-MM-DD format" },
      { status: 400 },
    );
  }

  if (startDate.getTime() > endDate.getTime()) {
    return NextResponse.json(
      { error: "Cycle end date must be on or after the start date" },
      { status: 400 },
    );
  }

  // Get next cycle number
  const lastCycle = await db
    .select({ number: cycle.number })
    .from(cycle)
    .where(eq(cycle.teamId, teamId))
    .orderBy(desc(cycle.number))
    .limit(1);

  const nextNumber = (lastCycle[0]?.number ?? 0) + 1;
  const existingCycles = await db
    .select({
      id: cycle.id,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
    })
    .from(cycle)
    .where(eq(cycle.teamId, teamId));

  const overlappingCycle = existingCycles.find((existingCycle) =>
    cycleRangesOverlap(
      startDate,
      endDate,
      existingCycle.startDate,
      existingCycle.endDate,
    ),
  );

  if (overlappingCycle) {
    return NextResponse.json(
      { error: "Cycle dates overlap with an existing cycle" },
      { status: 409 },
    );
  }

  const newCycle = await db
    .insert(cycle)
    .values({
      name: body.name ?? null,
      number: nextNumber,
      teamId,
      startDate,
      endDate,
      autoRollover: body.autoRollover ?? true,
    })
    .returning();

  return NextResponse.json(newCycle[0], { status: 201 });
}
