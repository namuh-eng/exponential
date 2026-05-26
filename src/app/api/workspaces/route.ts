import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  member,
  team,
  teamMember,
  user,
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
  const body = await request.json().catch(() => ({}));
  const { name, urlSlug, slug, hostingMode, hosting, ownerIdentity } = body as {
    name?: string;
    urlSlug?: string;
    slug?: string;
    hostingMode?: string;
    hosting?: string;
    ownerIdentity?: { email?: string; name?: string };
  };

  let session = null as Awaited<
    ReturnType<typeof requireApiSession>
  >["session"];
  if (!ownerIdentity?.email) {
    const auth = await requireApiSession();
    if (auth.response) return auth.response;
    session = auth.session;
  }

  const requestedSlug = sanitizeWorkspaceSlug(slug ?? urlSlug ?? "");
  const workspaceName = (name?.trim() || requestedSlug || "Workspace").trim();
  const nameError = validateWorkspaceName(workspaceName);
  const slugError =
    requestedSlug.length < 2 || requestedSlug.length > 63
      ? "URL slug must be between 2 and 63 characters"
      : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)
        ? null
        : "URL slug can only use lowercase letters, numbers, and single hyphens";
  const normalizedHosting = hostingMode ?? hosting ?? "hosted";

  if (
    nameError ||
    slugError ||
    !["hosted", "self-hosted", "self_hosted"].includes(normalizedHosting)
  ) {
    return NextResponse.json(
      {
        error:
          nameError ??
          slugError ??
          "Hosting mode must be hosted or self-hosted",
      },
      { status: 400 },
    );
  }

  const existing = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.urlSlug, requestedSlug))
    .limit(1);
  if (existing.length > 0)
    return NextResponse.json(
      { error: "This URL is already taken" },
      { status: 409 },
    );

  const owner = session?.user ?? {
    id: `signup-${ownerIdentity?.email?.trim().toLowerCase()}`,
    email: ownerIdentity?.email?.trim().toLowerCase() ?? "",
    name:
      ownerIdentity?.name?.trim() ||
      ownerIdentity?.email?.split("@")[0] ||
      "Owner",
    image: null,
  };
  if (!owner.email?.includes("@") && session)
    owner.email = `${owner.id}@local.test`;
  if (!owner.email?.includes("@"))
    return NextResponse.json(
      { error: "Owner email is required" },
      { status: 400 },
    );

  const result = await db.transaction(async (tx) => {
    if (!session) {
      await tx
        .insert(user)
        .values({
          id: owner.id,
          email: owner.email,
          name: owner.name,
          emailVerified: false,
        })
        .onConflictDoNothing();
    }
    const [newWorkspace] = await tx
      .insert(workspace)
      .values({
        name: workspaceName,
        urlSlug: requestedSlug,
        settings: {
          region: "United States",
          fiscalMonth: "january",
          hostingMode:
            normalizedHosting === "self_hosted"
              ? "self-hosted"
              : normalizedHosting,
          signupOwnerEmail: owner.email,
          signupEmailVerified: false,
        },
      })
      .returning();
    await tx.insert(member).values({
      userId: owner.id,
      workspaceId: newWorkspace.id,
      role: "owner",
    });
    const existingTeamKeys = await tx.select({ key: team.key }).from(team);
    const teamKey = generateTeamKey(
      workspaceName,
      existingTeamKeys.map(({ key }) => key),
    );
    const [newTeam] = await tx
      .insert(team)
      .values({
        name: workspaceName,
        key: teamKey,
        workspaceId: newWorkspace.id,
      })
      .returning();
    await tx
      .insert(teamMember)
      .values({ teamId: newTeam.id, userId: owner.id });
    await tx.insert(workflowState).values(getDefaultWorkflowStates(newTeam.id));
    return { workspace: newWorkspace, team: newTeam };
  });
  const response = NextResponse.json(result, { status: 201 });
  response.cookies.set("activeWorkspaceId", result.workspace.id, {
    path: "/",
    sameSite: "lax",
  });
  response.cookies.set("activeWorkspaceSlug", result.workspace.urlSlug, {
    path: "/",
    sameSite: "lax",
  });
  return response;
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
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
