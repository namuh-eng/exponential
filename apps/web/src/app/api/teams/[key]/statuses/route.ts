import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, member, team, workflowState } from "@/lib/db/schema";
import { findAccessibleTeam } from "@/lib/teams";
import { and, asc, count, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

const CATEGORY_ORDER = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
] as const;

type StatusCategory = (typeof CATEGORY_ORDER)[number];

type TeamRecord = NonNullable<Awaited<ReturnType<typeof findAccessibleTeam>>>;

type StatusBehavior = {
  terminalBehavior?: string;
  autoArchiveDays?: number | null;
  slaBehavior?: string;
};

type TeamSettings = Record<string, unknown> & {
  duplicateIssueStatusId?: string;
  statusBehaviors?: Record<string, StatusBehavior>;
};

function isStatusCategory(value: unknown): value is StatusCategory {
  return (
    typeof value === "string" &&
    CATEGORY_ORDER.includes(value as StatusCategory)
  );
}

function readTeamSettings(settings: unknown): TeamSettings {
  return settings && typeof settings === "object"
    ? (settings as TeamSettings)
    : {};
}

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDescription(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeColor(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

function normalizeBehavior(value: unknown): StatusBehavior | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const terminalBehavior =
    typeof input.terminalBehavior === "string"
      ? input.terminalBehavior
      : "standard";
  if (!["standard", "completed", "canceled"].includes(terminalBehavior))
    return null;
  const slaBehavior =
    typeof input.slaBehavior === "string" ? input.slaBehavior : "inherit";
  if (!["inherit", "pause", "complete", "ignore"].includes(slaBehavior))
    return null;
  let autoArchiveDays: number | null = null;
  if (input.autoArchiveDays !== null && input.autoArchiveDays !== undefined) {
    const n = Number(input.autoArchiveDays);
    if (!Number.isInteger(n) || n < 0 || n > 3650) return null;
    autoArchiveDays = n;
  }
  return { terminalBehavior, autoArchiveDays, slaBehavior };
}

async function persistStatusBehavior(
  teamRecord: TeamRecord,
  statusId: string,
  behavior: StatusBehavior | undefined,
) {
  if (behavior === undefined) return teamRecord.settings;
  const settings = readTeamSettings(teamRecord.settings);
  const statusBehaviors = { ...(settings.statusBehaviors ?? {}) };
  statusBehaviors[statusId] = behavior;
  const nextSettings = { ...settings, statusBehaviors };
  await db
    .update(team)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(team.id, teamRecord.id));
  return nextSettings;
}

async function canManageTeamStatuses(teamRecord: TeamRecord, userId: string) {
  const [record] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.workspaceId, teamRecord.workspaceId),
        eq(member.userId, userId),
      ),
    )
    .limit(1);

  return record?.role === "owner" || record?.role === "admin";
}

type TeamLookupResult =
  | { response: NextResponse; teamRecord: null }
  | { response: null; teamRecord: TeamRecord };

async function getTeamOrResponse(
  key: string,
  userId: string,
): Promise<TeamLookupResult> {
  const teamRecord = await findAccessibleTeam(key, userId);
  if (!teamRecord) {
    return {
      response: NextResponse.json({ error: "Team not found" }, { status: 404 }),
      teamRecord: null,
    };
  }

  return { response: null, teamRecord };
}

async function requireManageAccess(
  key: string,
  userId: string,
): Promise<TeamLookupResult> {
  const result = await getTeamOrResponse(key, userId);
  if (result.response) return result;

  const allowed = await canManageTeamStatuses(result.teamRecord, userId);
  if (!allowed) {
    return {
      response: NextResponse.json(
        { error: "Only workspace admins can manage team statuses" },
        { status: 403 },
      ),
      teamRecord: null,
    };
  }

  return { response: null, teamRecord: result.teamRecord };
}

async function buildStatusesResponse(teamRecord: TeamRecord) {
  const states = await db
    .select({
      id: workflowState.id,
      name: workflowState.name,
      category: workflowState.category,
      color: workflowState.color,
      description: workflowState.description,
      position: workflowState.position,
      isDefault: workflowState.isDefault,
    })
    .from(workflowState)
    .where(eq(workflowState.teamId, teamRecord.id))
    .orderBy(asc(workflowState.position), asc(workflowState.name));

  const issueCounts = await db
    .select({
      stateId: issue.stateId,
      count: count(),
    })
    .from(issue)
    .where(eq(issue.teamId, teamRecord.id))
    .groupBy(issue.stateId);

  const countMap = new Map(issueCounts.map((ic) => [ic.stateId, ic.count]));
  const grouped: Record<
    string,
    Array<{
      id: string;
      name: string;
      issueCount: number;
      description: string | null;
      color: string;
      position: number;
      isDefault: boolean | null;
      behavior: StatusBehavior;
    }>
  > = {};

  for (const cat of CATEGORY_ORDER) {
    grouped[cat] = [];
  }

  const statusBehaviors =
    readTeamSettings(teamRecord.settings).statusBehaviors ?? {};

  for (const state of states) {
    const cat = state.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      id: state.id,
      name: state.name,
      issueCount: countMap.get(state.id) ?? 0,
      description: state.description,
      color: state.color,
      position: state.position,
      isDefault: state.isDefault,
      behavior: statusBehaviors[state.id] ?? {},
    });
  }

  const settings = readTeamSettings(teamRecord.settings);
  const persistedDuplicateStatusId =
    typeof settings.duplicateIssueStatusId === "string"
      ? settings.duplicateIssueStatusId
      : null;
  const duplicateStatusId = states.some(
    (state) => state.id === persistedDuplicateStatusId,
  )
    ? persistedDuplicateStatusId
    : (states.find((state) => state.category === "canceled")?.id ??
      states[0]?.id ??
      null);

  return NextResponse.json({
    statuses: grouped,
    duplicateStatusId,
    canManage: true,
  });
}

async function ensureUniqueName(
  teamId: string,
  category: StatusCategory,
  name: string,
  ignoreId?: string,
) {
  const rows = await db
    .select({ id: workflowState.id, name: workflowState.name })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, teamId),
        eq(workflowState.category, category),
      ),
    );

  return !rows.some(
    (state) =>
      state.id !== ignoreId && state.name.toLowerCase() === name.toLowerCase(),
  );
}

async function categoryHasAnotherDefault(
  teamId: string,
  category: StatusCategory,
  ignoreId: string,
) {
  const [state] = await db
    .select({ id: workflowState.id })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, teamId),
        eq(workflowState.category, category),
        eq(workflowState.isDefault, true),
        ne(workflowState.id, ignoreId),
      ),
    )
    .limit(1);

  return Boolean(state);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const result = await getTeamOrResponse(key, session.user.id);
  if (result.response) return result.response;

  return buildStatusesResponse(result.teamRecord);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const result = await requireManageAccess(key, session.user.id);
  if (result.response) return result.response;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isStatusCategory(body.category)) {
    return NextResponse.json(
      { error: "Invalid status category" },
      { status: 400 },
    );
  }

  const name = normalizeName(body.name);
  if (!name) {
    return NextResponse.json(
      { error: "Status name is required" },
      { status: 400 },
    );
  }

  const color = normalizeColor(body.color);
  if (color === null) {
    return NextResponse.json(
      { error: "Color must be a hex value" },
      { status: 400 },
    );
  }

  if (!(await ensureUniqueName(result.teamRecord.id, body.category, name))) {
    return NextResponse.json(
      { error: "A status with that name already exists in this category" },
      { status: 409 },
    );
  }

  const behavior = normalizeBehavior(body.behavior);
  if (behavior === null) {
    return NextResponse.json(
      { error: "Invalid status behavior" },
      { status: 400 },
    );
  }

  const categoryStates = await db
    .select({ position: workflowState.position })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, result.teamRecord.id),
        eq(workflowState.category, body.category),
      ),
    );
  const nextPosition =
    Math.max(-1, ...categoryStates.map((state) => Number(state.position))) + 1;

  const isFirstInCategory = categoryStates.length === 0;

  const [created] = await db
    .insert(workflowState)
    .values({
      teamId: result.teamRecord.id,
      category: body.category,
      name,
      description: normalizeDescription(body.description),
      color: color ?? "#6b6f76",
      position: nextPosition,
      isDefault: isFirstInCategory,
      updatedAt: new Date(),
    })
    .returning({ id: workflowState.id });

  const settings = await persistStatusBehavior(
    result.teamRecord,
    created.id,
    behavior ?? undefined,
  );
  return buildStatusesResponse({ ...result.teamRecord, settings });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const result = await requireManageAccess(key, session.user.id);
  if (result.response) return result.response;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.duplicateStatusId === "string") {
    const [target] = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.teamId, result.teamRecord.id),
          eq(workflowState.id, body.duplicateStatusId),
        ),
      )
      .limit(1);

    if (!target) {
      return NextResponse.json(
        { error: "Duplicate issue status must exist on this team" },
        { status: 400 },
      );
    }

    await db
      .update(team)
      .set({
        settings: {
          ...readTeamSettings(result.teamRecord.settings),
          duplicateIssueStatusId: target.id,
        },
        updatedAt: new Date(),
      })
      .where(eq(team.id, result.teamRecord.id));

    return buildStatusesResponse({
      ...result.teamRecord,
      settings: {
        ...readTeamSettings(result.teamRecord.settings),
        duplicateIssueStatusId: target.id,
      },
    });
  }

  if (body.reorder && typeof body.reorder === "object") {
    const reorder = body.reorder as Record<string, unknown>;
    if (
      !isStatusCategory(reorder.category) ||
      !Array.isArray(reorder.orderedIds)
    ) {
      return NextResponse.json(
        { error: "Invalid reorder payload" },
        { status: 400 },
      );
    }

    const orderedIds = reorder.orderedIds.filter(
      (id): id is string => typeof id === "string",
    );
    if (orderedIds.length !== reorder.orderedIds.length) {
      return NextResponse.json(
        { error: "Invalid reorder payload" },
        { status: 400 },
      );
    }

    const categoryStates = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.teamId, result.teamRecord.id),
          eq(workflowState.category, reorder.category),
        ),
      );
    const categoryIds = categoryStates.map((state) => state.id).sort();
    const sortedOrderedIds = [...orderedIds].sort();
    if (
      categoryIds.length !== sortedOrderedIds.length ||
      categoryIds.some((id, index) => id !== sortedOrderedIds[index])
    ) {
      return NextResponse.json(
        { error: "Reorder must include every status in the category" },
        { status: 400 },
      );
    }

    await Promise.all(
      orderedIds.map((id, position) =>
        db
          .update(workflowState)
          .set({ position, updatedAt: new Date() })
          .where(eq(workflowState.id, id)),
      ),
    );

    return buildStatusesResponse(result.teamRecord);
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json(
      { error: "Status id is required" },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select({
      id: workflowState.id,
      category: workflowState.category,
      isDefault: workflowState.isDefault,
    })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, result.teamRecord.id),
        eq(workflowState.id, id),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Status not found" }, { status: 404 });
  }

  const name = body.name === undefined ? undefined : normalizeName(body.name);
  if (body.name !== undefined && !name) {
    return NextResponse.json(
      { error: "Status name is required" },
      { status: 400 },
    );
  }

  const nextCategory =
    body.category === undefined
      ? existing.category
      : isStatusCategory(body.category)
        ? body.category
        : null;
  if (!nextCategory) {
    return NextResponse.json(
      { error: "Invalid status category" },
      { status: 400 },
    );
  }

  if (
    name &&
    !(await ensureUniqueName(result.teamRecord.id, nextCategory, name, id))
  ) {
    return NextResponse.json(
      { error: "A status with that name already exists in this category" },
      { status: 409 },
    );
  }

  const color = normalizeColor(body.color);
  if (color === null) {
    return NextResponse.json(
      { error: "Color must be a hex value" },
      { status: 400 },
    );
  }

  const targetCategoryStates = await db
    .select({
      id: workflowState.id,
      position: workflowState.position,
      isDefault: workflowState.isDefault,
    })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, result.teamRecord.id),
        eq(workflowState.category, nextCategory),
      ),
    );
  const targetCategoryWillBeEmpty =
    nextCategory !== existing.category && targetCategoryStates.length === 0;

  const nextIsDefault = targetCategoryWillBeEmpty
    ? true
    : body.isDefault === undefined
      ? existing.isDefault === true
      : body.isDefault === true;

  const behavior = normalizeBehavior(body.behavior);
  if (behavior === null) {
    return NextResponse.json(
      { error: "Invalid status behavior" },
      { status: 400 },
    );
  }

  if (
    existing.isDefault === true &&
    (nextCategory !== existing.category || !nextIsDefault) &&
    !(await categoryHasAnotherDefault(
      result.teamRecord.id,
      existing.category,
      existing.id,
    ))
  ) {
    return NextResponse.json(
      { error: "Each workflow category must have a default status" },
      { status: 400 },
    );
  }

  await db
    .update(workflowState)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(body.description !== undefined
        ? { description: normalizeDescription(body.description) }
        : {}),
      ...(color !== undefined ? { color } : {}),
      ...(body.category !== undefined ? { category: nextCategory } : {}),
      ...(body.category !== undefined && nextCategory !== existing.category
        ? {
            position:
              Math.max(
                -1,
                ...targetCategoryStates.map((state) => Number(state.position)),
              ) + 1,
          }
        : {}),
      ...(body.isDefault !== undefined || targetCategoryWillBeEmpty
        ? { isDefault: nextIsDefault }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(workflowState.id, id));

  const nextSettings = await persistStatusBehavior(
    result.teamRecord,
    id,
    behavior ?? undefined,
  );

  if (nextIsDefault) {
    await db
      .update(workflowState)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(workflowState.teamId, result.teamRecord.id),
          eq(workflowState.category, nextCategory),
          ne(workflowState.id, id),
        ),
      );
  }

  return buildStatusesResponse({
    ...result.teamRecord,
    settings: nextSettings,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const result = await requireManageAccess(key, session.user.id);
  if (result.response) return result.response;

  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    replacementStatusId?: unknown;
  } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json(
      { error: "Status id is required" },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select({ id: workflowState.id, isDefault: workflowState.isDefault })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, result.teamRecord.id),
        eq(workflowState.id, id),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Status not found" }, { status: 404 });
  }
  if (existing.isDefault) {
    return NextResponse.json(
      { error: "Default statuses cannot be deleted" },
      { status: 400 },
    );
  }

  const [{ value: issueCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(issue)
    .where(eq(issue.stateId, id));

  if (Number(issueCount) > 0) {
    const replacementStatusId =
      typeof body?.replacementStatusId === "string"
        ? body.replacementStatusId
        : "";
    if (!replacementStatusId) {
      return NextResponse.json(
        { error: "Statuses with issues require a replacement status" },
        { status: 400 },
      );
    }

    const [replacement] = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.teamId, result.teamRecord.id),
          eq(workflowState.id, replacementStatusId),
        ),
      )
      .limit(1);
    if (!replacement || replacement.id === id) {
      return NextResponse.json(
        { error: "Replacement status must exist on this team" },
        { status: 400 },
      );
    }

    await db
      .update(issue)
      .set({ stateId: replacement.id })
      .where(eq(issue.stateId, id));
  }

  await db.delete(workflowState).where(eq(workflowState.id, id));

  const settings = readTeamSettings(result.teamRecord.settings);
  const statusBehaviors = { ...(settings.statusBehaviors ?? {}) };
  delete statusBehaviors[id];
  if (settings.statusBehaviors) {
    await db
      .update(team)
      .set({
        settings: { ...settings, statusBehaviors },
        updatedAt: new Date(),
      })
      .where(eq(team.id, result.teamRecord.id));
  }

  if (settings.duplicateIssueStatusId === id) {
    const [fallback] = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(eq(workflowState.teamId, result.teamRecord.id))
      .orderBy(asc(workflowState.position))
      .limit(1);
    await db
      .update(team)
      .set({
        settings: {
          ...settings,
          statusBehaviors,
          duplicateIssueStatusId: fallback?.id,
        },
        updatedAt: new Date(),
      })
      .where(eq(team.id, result.teamRecord.id));
  }

  return buildStatusesResponse(result.teamRecord);
}
