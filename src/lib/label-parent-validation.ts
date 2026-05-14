import { db } from "@/lib/db";
import { label } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

type WorkspaceLabel = {
  id: string;
  parentLabelId: string | null;
};

async function findWorkspaceLabel(
  labelId: string,
  workspaceId: string,
): Promise<WorkspaceLabel | null> {
  const [row] = await db
    .select({ id: label.id, parentLabelId: label.parentLabelId })
    .from(label)
    .where(
      and(
        eq(label.id, labelId),
        eq(label.workspaceId, workspaceId),
        isNull(label.teamId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function validateWorkspaceParentLabel({
  workspaceId,
  parentLabelId,
  currentLabelId,
}: {
  workspaceId: string;
  parentLabelId: unknown;
  currentLabelId?: string;
}): Promise<
  | { ok: true; parentLabelId: string | null }
  | { ok: false; error: string; status: number }
> {
  if (
    parentLabelId === undefined ||
    parentLabelId === null ||
    parentLabelId === ""
  ) {
    return { ok: true, parentLabelId: null };
  }

  if (typeof parentLabelId !== "string") {
    return { ok: false, error: "Invalid parent label", status: 400 };
  }

  if (currentLabelId && parentLabelId === currentLabelId) {
    return {
      ok: false,
      error: "A label cannot be its own parent",
      status: 400,
    };
  }

  let parent = await findWorkspaceLabel(parentLabelId, workspaceId);
  if (!parent) {
    return { ok: false, error: "Parent label not found", status: 400 };
  }

  const seen = new Set<string>([parent.id]);
  while (parent.parentLabelId) {
    if (currentLabelId && parent.parentLabelId === currentLabelId) {
      return {
        ok: false,
        error: "Parent label would create a cycle",
        status: 400,
      };
    }
    if (seen.has(parent.parentLabelId)) {
      return { ok: false, error: "Parent label has a cycle", status: 400 };
    }
    seen.add(parent.parentLabelId);
    parent = await findWorkspaceLabel(parent.parentLabelId, workspaceId);
    if (!parent) {
      return { ok: false, error: "Parent label not found", status: 400 };
    }
  }

  return { ok: true, parentLabelId };
}
