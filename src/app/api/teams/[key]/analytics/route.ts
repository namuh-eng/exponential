import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  cycle,
  issue,
  issueLabel,
  label,
  project,
  workflowState,
} from "@/lib/db/schema";
import {
  buildAnalyticsResponse,
  normalizeAnalyticsQuery,
} from "@/lib/team-analytics";
import { findAccessibleTeam } from "@/lib/teams";
import { desc, eq, inArray } from "drizzle-orm";
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

  const query = normalizeAnalyticsQuery(new URL(request.url).searchParams);

  const rows = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      estimate: issue.estimate,
      createdAt: issue.createdAt,
      completedAt: issue.completedAt,
      updatedAt: issue.updatedAt,
      statusName: workflowState.name,
      statusCategory: workflowState.category,
      projectId: project.id,
      projectName: project.name,
      cycleId: cycle.id,
      cycleName: cycle.name,
      cycleNumber: cycle.number,
    })
    .from(issue)
    .leftJoin(workflowState, eq(issue.stateId, workflowState.id))
    .leftJoin(project, eq(issue.projectId, project.id))
    .leftJoin(cycle, eq(issue.cycleId, cycle.id))
    .where(eq(issue.teamId, teamRecord.id))
    .orderBy(desc(issue.updatedAt));

  const issueIds = rows.map((row) => row.id);
  const labelRows = issueIds.length
    ? await db
        .select({ issueId: issueLabel.issueId, labelName: label.name })
        .from(issueLabel)
        .innerJoin(label, eq(issueLabel.labelId, label.id))
        .where(inArray(issueLabel.issueId, issueIds))
    : [];

  const labelsByIssue = new Map<string, string[]>();
  for (const row of labelRows) {
    const names = labelsByIssue.get(row.issueId) ?? [];
    names.push(row.labelName);
    labelsByIssue.set(row.issueId, names);
  }

  const issues = rows.map((row) => ({
    ...row,
    labels: labelsByIssue.get(row.id) ?? [],
  }));

  const recentCycles = await db
    .select({
      id: cycle.id,
      name: cycle.name,
      number: cycle.number,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
    })
    .from(cycle)
    .where(eq(cycle.teamId, teamRecord.id))
    .orderBy(desc(cycle.endDate))
    .limit(5);

  const cycleSources = recentCycles.map((record) => {
    const cycleIssues = issues.filter((row) => row.cycleId === record.id);
    return {
      id: record.id,
      name: record.name || `Cycle ${record.number}`,
      startDate: record.startDate,
      endDate: record.endDate,
      total: cycleIssues.length,
      completed: cycleIssues.filter((row) => row.completedAt).length,
    };
  });

  return NextResponse.json(
    buildAnalyticsResponse({
      team: { id: teamRecord.id, name: teamRecord.name, key: teamRecord.key },
      query,
      issues,
      cycles: cycleSources,
    }),
  );
}
