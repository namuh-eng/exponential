import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, user, workflowState } from "@/lib/db/schema";
import { getLabelsForIssues } from "@/lib/issue-labels";
import { getTeamByKey } from "@/lib/teams";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response } = await requireApiSession();
  if (response) {
    return response;
  }

  const { key } = await params;

  const teamRecord = await getTeamByKey(key);
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  // Find triage workflow states
  const triageStates = await db
    .select({
      id: workflowState.id,
      name: workflowState.name,
      color: workflowState.color,
    })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, teamRecord.id),
        eq(workflowState.category, "triage"),
      ),
    );

  if (triageStates.length === 0) {
    return NextResponse.json({
      team: teamRecord,
      issues: [],
      count: 0,
      createStateId: null,
      createStateName: null,
    });
  }

  const triageStateIds = triageStates.map((s) => s.id);

  // Get issues in triage state with creator info
  const issues = await db
    .select({
      id: issue.id,
      number: issue.number,
      identifier: issue.identifier,
      title: issue.title,
      priority: issue.priority,
      stateId: issue.stateId,
      stateName: workflowState.name,
      stateColor: workflowState.color,
      creatorId: issue.creatorId,
      creatorName: user.name,
      creatorImage: user.image,
      createdAt: issue.createdAt,
    })
    .from(issue)
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .leftJoin(user, eq(issue.creatorId, user.id))
    .where(
      and(
        eq(issue.teamId, teamRecord.id),
        inArray(issue.stateId, triageStateIds),
      ),
    )
    .orderBy(desc(issue.createdAt));

  // Get labels for issues
  const issueIds = issues.map((i) => i.id);
  const labelsMap = await getLabelsForIssues(issueIds);

  const formattedIssues = issues.map((i) => ({
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    priority: i.priority,
    stateId: i.stateId,
    stateName: i.stateName,
    stateColor: i.stateColor,
    creatorId: i.creatorId,
    creatorName: i.creatorName ?? "Unknown",
    creatorImage: i.creatorImage,
    createdAt: i.createdAt,
    labelIds: (labelsMap[i.id] ?? []).map((currentLabel) => currentLabel.id),
    labels: labelsMap[i.id] ?? [],
    assigneeId: null,
    projectId: null,
  }));

  return NextResponse.json({
    team: teamRecord,
    issues: formattedIssues,
    count: formattedIssues.length,
    createStateId: triageStateIds[0] ?? null,
    createStateName: triageStates[0]?.name ?? null,
  });
}
