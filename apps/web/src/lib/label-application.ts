import { label } from "@/lib/db/schema";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

type LabelRow = {
  id: string;
  parentLabelId: string | null;
};

type LabelQueryDb = {
  // Drizzle database or transaction; selected query shape is validated by call sites.
  select: (fields: Record<string, unknown>) => unknown;
};

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function enforceOneLabelPerGroup(requestedIds: string[], rows: LabelRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selectedByGroup = new Map<string, string>();
  const ungrouped: string[] = [];

  for (const id of requestedIds) {
    const row = byId.get(id);
    if (!row) continue;
    if (row.parentLabelId) {
      selectedByGroup.set(row.parentLabelId, row.id);
    } else {
      ungrouped.push(row.id);
    }
  }

  return [...ungrouped, ...selectedByGroup.values()];
}

export async function normalizeApplicableIssueLabelIds({
  db,
  labelIds,
  workspaceId,
  teamId,
}: {
  db: LabelQueryDb;
  labelIds: unknown;
  workspaceId: string;
  teamId: string;
}) {
  const requestedIds = uniqueStrings(labelIds);
  if (requestedIds.length === 0) {
    return { ok: true as const, labelIds: [] as string[] };
  }

  const query = db.select({
    id: label.id,
    parentLabelId: label.parentLabelId,
  }) as {
    from: (source: unknown) => {
      where: (condition: unknown) => Promise<LabelRow[]>;
    };
  };
  const rows = await query
    .from(label)
    .where(
      and(
        inArray(label.id, requestedIds),
        eq(label.workspaceId, workspaceId),
        isNull(label.archivedAt),
        or(isNull(label.teamId), eq(label.teamId, teamId)),
      ),
    );

  if (rows.length !== requestedIds.length) {
    return {
      ok: false as const,
      error: "One or more labels were not found or are archived",
    };
  }

  return {
    ok: true as const,
    labelIds: enforceOneLabelPerGroup(requestedIds, rows),
  };
}

export async function normalizeBulkIssueLabelIds({
  db,
  labelIds,
  workspaceId,
  teamIds,
}: {
  db: LabelQueryDb;
  labelIds: unknown;
  workspaceId: string;
  teamIds: string[];
}) {
  const requestedIds = uniqueStrings(labelIds);
  if (requestedIds.length === 0) {
    return { ok: true as const, labelIds: [] as string[] };
  }

  const query = db.select({
    id: label.id,
    parentLabelId: label.parentLabelId,
  }) as {
    from: (source: unknown) => {
      where: (condition: unknown) => Promise<LabelRow[]>;
    };
  };
  const rows = await query
    .from(label)
    .where(
      and(
        inArray(label.id, requestedIds),
        eq(label.workspaceId, workspaceId),
        isNull(label.archivedAt),
        or(isNull(label.teamId), inArray(label.teamId, teamIds)),
      ),
    );

  if (rows.length !== requestedIds.length) {
    return {
      ok: false as const,
      error: "One or more labels were not found or are archived",
    };
  }

  return {
    ok: true as const,
    labelIds: enforceOneLabelPerGroup(requestedIds, rows),
  };
}
