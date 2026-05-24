import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  comment,
  issue,
  label,
  member,
  project,
  projectTeam,
  team,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import {
  createHeadlessWorkspacesClient,
  headlessWorkspacesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import {
  type CsvMapping,
  type ImportExportJobSummary,
  type ImportProvider,
  asRecord,
  buildCsvPreview,
  inferCsvMapping,
  makeJobId,
  normalizePriority,
  readCsvValue,
  readImportExportState,
  writeImportExportState,
} from "@/lib/import-export";
import { normalizeIssueDescriptionHtml } from "@/lib/issue-description";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import { isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

type CurrentWorkspace = {
  id: string;
  name: string;
  urlSlug: string;
  settings: unknown;
  role: string;
};

type ImportExportBody =
  | { action: "request_export" }
  | {
      action: "preview_csv";
      fileName?: unknown;
      csv?: unknown;
      mapping?: unknown;
    }
  | {
      action: "start_csv_import";
      fileName?: unknown;
      csv?: unknown;
      mapping?: unknown;
      defaultTeamId?: unknown;
    }
  | { action: "prepare_provider"; provider?: unknown };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function findCurrentWorkspace(userId: string, request: Request) {
  const workspaceId = await resolveRequestWorkspaceId(userId, request);
  if (!workspaceId) return null;

  const [record] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      urlSlug: workspace.urlSlug,
      settings: workspace.settings,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, userId),
        eq(member.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return (record as CurrentWorkspace | undefined) ?? null;
}

async function requireAdminWorkspace(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse)
    return { response: authResponse, session: null, workspace: null };
  const currentWorkspace = await findCurrentWorkspace(session.user.id, request);
  if (!currentWorkspace) {
    return {
      response: jsonError("No active workspace found", 404),
      session: null,
      workspace: null,
    };
  }
  if (!isWorkspaceAdminRole(currentWorkspace.role)) {
    return {
      response: jsonError(
        "Only workspace admins can import or export workspace data",
        403,
      ),
      session: null,
      workspace: null,
    };
  }
  return { response: null, session, workspace: currentWorkspace };
}

async function listWorkspaceTeams(workspaceId: string) {
  return db
    .select({
      id: team.id,
      key: team.key,
      name: team.name,
      settings: team.settings,
    })
    .from(team)
    .where(eq(team.workspaceId, workspaceId));
}

async function listImportableStates(teamIds: string[]) {
  if (teamIds.length === 0) return [];
  return db
    .select({
      id: workflowState.id,
      teamId: workflowState.teamId,
      name: workflowState.name,
      category: workflowState.category,
    })
    .from(workflowState)
    .where(inArray(workflowState.teamId, teamIds));
}

function pickDefaultState(
  states: Awaited<ReturnType<typeof listImportableStates>>,
  teamId: string,
) {
  return (
    states.find(
      (state) => state.teamId === teamId && state.category === "backlog",
    ) ??
    states.find((state) => state.teamId === teamId) ??
    null
  );
}

async function saveState(
  currentWorkspace: CurrentWorkspace,
  nextState: ReturnType<typeof readImportExportState>,
) {
  await db
    .update(workspace)
    .set({
      settings: writeImportExportState(currentWorkspace.settings, nextState),
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, currentWorkspace.id));
}

async function buildExportArtifact(currentWorkspace: CurrentWorkspace) {
  const workspaceId = currentWorkspace.id;
  const [teams, states, labels, projects, members] = await Promise.all([
    db.select().from(team).where(eq(team.workspaceId, workspaceId)),
    db
      .select({
        id: workflowState.id,
        name: workflowState.name,
        teamId: workflowState.teamId,
        category: workflowState.category,
        color: workflowState.color,
      })
      .from(workflowState)
      .innerJoin(team, eq(workflowState.teamId, team.id))
      .where(eq(team.workspaceId, workspaceId)),
    db.select().from(label).where(eq(label.workspaceId, workspaceId)),
    db.select().from(project).where(eq(project.workspaceId, workspaceId)),
    db
      .select({
        id: member.id,
        role: member.role,
        userId: user.id,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.workspaceId, workspaceId)),
  ]);
  const teamIds = teams.map((teamRecord) => teamRecord.id);
  const projectIds = projects.map((projectRecord) => projectRecord.id);
  const projectLinks = projectIds.length
    ? await db
        .select()
        .from(projectTeam)
        .where(inArray(projectTeam.projectId, projectIds))
    : [];
  const issues = teamIds.length
    ? await db.select().from(issue).where(inArray(issue.teamId, teamIds))
    : [];
  const issueIds = issues.map((issueRecord) => issueRecord.id);
  const comments = issueIds.length
    ? await db.select().from(comment).where(inArray(comment.issueId, issueIds))
    : [];
  const allowedProjectIds = new Set(projectIds);

  return {
    exportedAt: new Date().toISOString(),
    workspace: {
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      urlSlug: currentWorkspace.urlSlug,
    },
    teams,
    workflowStates: states,
    labels,
    projects,
    projectTeams: projectLinks.filter((link) =>
      allowedProjectIds.has(link.projectId),
    ),
    members,
    issues,
    comments,
  };
}

function readMapping(value: unknown, headers: string[]): CsvMapping {
  const inferred = inferCsvMapping(headers);
  const record = asRecord(value);
  return {
    title:
      typeof record.title === "string" && record.title
        ? record.title
        : inferred.title,
    description:
      typeof record.description === "string"
        ? record.description
        : inferred.description,
    priority:
      typeof record.priority === "string" ? record.priority : inferred.priority,
    teamKey:
      typeof record.teamKey === "string" ? record.teamKey : inferred.teamKey,
  };
}

export async function GET(request: Request) {
  const gate = await requireAdminWorkspace(request);
  if (gate.response) return gate.response;
  const currentWorkspace = gate.workspace;
  if (!currentWorkspace) return jsonError("No active workspace found", 404);

  if (headlessWorkspacesEnabled()) {
    const token = await mintInternalApiToken({
      userId: gate.session.user.id,
      workspaceId: currentWorkspace.id,
    });
    const client = createHeadlessWorkspacesClient(token);
    const { data, error, response } = await client.GET(
      "/workspaces/current/import-export",
    );
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const teams = await listWorkspaceTeams(currentWorkspace.id);
  const state = readImportExportState(currentWorkspace.settings);
  return NextResponse.json({
    workspace: {
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      urlSlug: currentWorkspace.urlSlug,
    },
    capabilities: {
      canExport: true,
      canImportCsv: true,
      canConfigureProviders: true,
    },
    teams,
    imports: state.imports,
    exports: state.exports,
  });
}

export async function POST(request: Request) {
  const gate = await requireAdminWorkspace(request);
  if (gate.response) return gate.response;
  const currentWorkspace = gate.workspace;
  const session = gate.session;
  if (!currentWorkspace || !session)
    return jsonError("No active workspace found", 404);

  const body = (await request
    .json()
    .catch(() => null)) as ImportExportBody | null;
  if (!body || typeof body.action !== "string")
    return jsonError("Invalid import/export request", 400);

  if (headlessWorkspacesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: currentWorkspace.id,
    });
    const client = createHeadlessWorkspacesClient(token);
    const { data, error, response } = await client.POST(
      "/workspaces/current/import-export",
      { body: body as never },
    );
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  if (body.action === "request_export") {
    const artifact = await buildExportArtifact(currentWorkspace);
    const jobId = makeJobId("export");
    const now = new Date().toISOString();
    const state = readImportExportState(currentWorkspace.settings);
    const issueCount = Array.isArray(artifact.issues)
      ? artifact.issues.length
      : 0;
    state.artifacts[jobId] = artifact;
    const exportJob: ImportExportJobSummary = {
      id: jobId,
      type: "export",
      status: "completed",
      createdAt: now,
      completedAt: now,
      message: `Workspace export completed with ${issueCount} issues.`,
      rowCount: issueCount,
      downloadUrl: `/api/workspaces/current/import-export/exports/${jobId}/download`,
    };
    state.exports = [exportJob, ...state.exports].slice(0, 25);
    await saveState(currentWorkspace, state);
    return NextResponse.json({ export: state.exports[0] }, { status: 201 });
  }

  if (body.action === "preview_csv") {
    if (typeof body.csv !== "string" || !body.csv.trim())
      return jsonError("CSV content is required", 400);
    const preliminary = buildCsvPreview(body.csv);
    const mapping = readMapping(body.mapping, preliminary.headers);
    const preview = buildCsvPreview(body.csv, mapping);
    return NextResponse.json({ mapping, preview });
  }

  if (body.action === "prepare_provider") {
    const provider = body.provider as ImportProvider;
    if (provider !== "github" && provider !== "jira")
      return jsonError("Unsupported provider", 400);
    const jobId = makeJobId("import");
    const now = new Date().toISOString();
    const state = readImportExportState(currentWorkspace.settings);
    const importJob: ImportExportJobSummary = {
      id: jobId,
      type: "import",
      provider,
      status: "queued",
      createdAt: now,
      message: `${provider === "github" ? "GitHub" : "Jira"} import setup is ready. Connect the integration to choose projects and start a guided import.`,
    };
    state.imports = [importJob, ...state.imports].slice(0, 25);
    await saveState(currentWorkspace, state);
    return NextResponse.json(
      { import: state.imports[0], setupUrl: "/settings/integrations" },
      { status: 201 },
    );
  }

  if (body.action === "start_csv_import") {
    if (typeof body.csv !== "string" || !body.csv.trim())
      return jsonError("CSV content is required", 400);
    const preliminary = buildCsvPreview(body.csv);
    const mapping = readMapping(body.mapping, preliminary.headers);
    const preview = buildCsvPreview(body.csv, mapping);
    if (preview.errorCount > 0)
      return NextResponse.json(
        {
          mapping,
          preview,
          error: "Fix CSV validation errors before importing",
        },
        { status: 422 },
      );

    const teams = await listWorkspaceTeams(currentWorkspace.id);
    if (teams.length === 0)
      return jsonError("Create a team before importing issues", 400);
    const states = await listImportableStates(
      teams.map((teamRecord) => teamRecord.id),
    );
    const teamByKey = new Map(
      teams.map((teamRecord) => [teamRecord.key.toLowerCase(), teamRecord]),
    );
    const fallbackTeam =
      teams.find((teamRecord) => teamRecord.id === body.defaultTeamId) ??
      teams[0];
    const maxNumbers = new Map<string, number>();
    for (const teamRecord of teams) {
      const maxResult = await db
        .select({ maxNum: sql<number>`COALESCE(MAX(${issue.number}), 0)` })
        .from(issue)
        .where(eq(issue.teamId, teamRecord.id));
      maxNumbers.set(teamRecord.id, Number(maxResult[0]?.maxNum ?? 0));
    }

    const createdIssues = await db.transaction(async (tx) => {
      const created = [];
      for (const row of preview.rows) {
        const requestedTeamKey = readCsvValue(
          row.values,
          mapping.teamKey,
        ).toLowerCase();
        const targetTeam = requestedTeamKey
          ? (teamByKey.get(requestedTeamKey) ?? fallbackTeam)
          : fallbackTeam;
        const defaultState = pickDefaultState(states, targetTeam.id);
        if (!defaultState)
          throw new Error(`No workflow state found for ${targetTeam.key}`);
        const nextNumber = (maxNumbers.get(targetTeam.id) ?? 0) + 1;
        maxNumbers.set(targetTeam.id, nextNumber);
        const [createdIssue] = await tx
          .insert(issue)
          .values({
            number: nextNumber,
            identifier: `${targetTeam.key}-${nextNumber}`,
            title: readCsvValue(row.values, mapping.title),
            description: normalizeIssueDescriptionHtml(
              readCsvValue(row.values, mapping.description),
            ),
            teamId: targetTeam.id,
            stateId: defaultState.id,
            creatorId: session.user.id,
            priority: normalizePriority(
              readCsvValue(row.values, mapping.priority),
            ),
          })
          .returning();
        await insertIssueHistoryEvent(tx, targetTeam, {
          issueId: createdIssue.id,
          actorId: session.user.id,
          actorName: session.user.name ?? null,
          actorEmail: session.user.email ?? null,
          eventType: "created",
          metadata: {
            identifier: createdIssue.identifier,
            title: createdIssue.title,
            importSource: "csv",
          },
        });
        created.push(createdIssue);
      }
      return created;
    });

    const jobId = makeJobId("import");
    const now = new Date().toISOString();
    const state = readImportExportState(currentWorkspace.settings);
    const importJob: ImportExportJobSummary = {
      id: jobId,
      type: "import",
      provider: "csv",
      status: "completed",
      createdAt: now,
      completedAt: now,
      fileName:
        typeof body.fileName === "string"
          ? body.fileName
          : "workspace-import.csv",
      message: `CSV import completed with ${createdIssues.length} issues created.`,
      rowCount: preview.rowCount,
      importedCount: createdIssues.length,
      errorCount: 0,
    };
    state.imports = [importJob, ...state.imports].slice(0, 25);
    await saveState(currentWorkspace, state);
    return NextResponse.json(
      { import: state.imports[0], issues: createdIssues },
      { status: 201 },
    );
  }

  return jsonError("Unsupported import/export action", 400);
}
