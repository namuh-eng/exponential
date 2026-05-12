import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  member,
  team,
  teamMember,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import {
  generateTeamKey,
  getDefaultWorkflowStates,
  sanitizeWorkspaceSlug,
  validateWorkspaceName,
} from "@/lib/workspace-creation";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const body = await request.json();
  const { name, urlSlug } = body as { name: string; urlSlug: string };

  const nameError = validateWorkspaceName(name ?? "");

  if (nameError || !urlSlug?.trim()) {
    return NextResponse.json(
      { error: nameError ?? "Name and URL slug are required" },
      { status: 400 },
    );
  }

  const slug = sanitizeWorkspaceSlug(urlSlug);

  if (slug.length < 2 || slug.length > 63) {
    return NextResponse.json(
      { error: "URL slug must be between 2 and 63 characters" },
      { status: 400 },
    );
  }

  // Check for slug uniqueness
  const existing = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.urlSlug, slug))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "This URL is already taken" },
      { status: 409 },
    );
  }

  // Create workspace, member, team, team member, and workflow states in a transaction
  const result = await db.transaction(async (tx) => {
    const [newWorkspace] = await tx
      .insert(workspace)
      .values({
        name: name.trim(),
        urlSlug: slug,
        settings: {
          region: "United States",
          fiscalMonth: "january",
        },
      })
      .returning();

    // Add creator as owner
    await tx.insert(member).values({
      userId: session.user.id,
      workspaceId: newWorkspace.id,
      role: "owner",
    });

    const existingTeamKeys = await tx.select({ key: team.key }).from(team);
    const teamKey = generateTeamKey(
      name,
      existingTeamKeys.map(({ key }) => key),
    );

    const [newTeam] = await tx
      .insert(team)
      .values({
        name: name.trim(),
        key: teamKey,
        workspaceId: newWorkspace.id,
      })
      .returning();

    // Add creator to default team
    await tx.insert(teamMember).values({
      teamId: newTeam.id,
      userId: session.user.id,
    });

    // Create default workflow states
    await tx.insert(workflowState).values(getDefaultWorkflowStates(newTeam.id));

    return { workspace: newWorkspace, team: newTeam };
  });

  return NextResponse.json(result, { status: 201 });
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  // Get all workspaces the user is a member of
  const memberships = await db
    .select({
      workspaceId: member.workspaceId,
      role: member.role,
      workspaceName: workspace.name,
      workspaceSlug: workspace.urlSlug,
    })
    .from(member)
    .innerJoin(workspace, eq(member.workspaceId, workspace.id))
    .where(eq(member.userId, session.user.id));

  return NextResponse.json(memberships);
}
