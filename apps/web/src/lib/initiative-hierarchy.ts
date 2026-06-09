export interface InitiativeHierarchyNode {
  id: string;
  name?: string | null;
  parentInitiativeId: string | null;
}

const CIRCULAR_HIERARCHY_ERROR =
  "Cannot create a circular initiative hierarchy";

export function getInitiativeName(
  initiatives: InitiativeHierarchyNode[],
  initiativeId: string | null | undefined,
) {
  if (!initiativeId) {
    return "None";
  }

  return (
    initiatives.find((initiative) => initiative.id === initiativeId)?.name ??
    initiativeId
  );
}

export function getDescendantInitiativeIds(
  initiatives: InitiativeHierarchyNode[],
  initiativeId: string,
) {
  const childrenByParent = new Map<string, string[]>();

  for (const initiative of initiatives) {
    if (!initiative.parentInitiativeId) {
      continue;
    }

    childrenByParent.set(initiative.parentInitiativeId, [
      ...(childrenByParent.get(initiative.parentInitiativeId) ?? []),
      initiative.id,
    ]);
  }

  const descendants = new Set<string>();
  const pending = [...(childrenByParent.get(initiativeId) ?? [])];

  while (pending.length > 0) {
    const childId = pending.shift();
    if (!childId || descendants.has(childId)) {
      continue;
    }

    descendants.add(childId);
    pending.push(...(childrenByParent.get(childId) ?? []));
  }

  return descendants;
}

export function validateInitiativeParentLink(
  initiatives: InitiativeHierarchyNode[],
  childInitiativeId: string,
  parentInitiativeId: string | null,
) {
  if (!parentInitiativeId) {
    return { ok: true as const };
  }

  if (childInitiativeId === parentInitiativeId) {
    return {
      ok: false as const,
      error: CIRCULAR_HIERARCHY_ERROR,
    };
  }

  const parentById = new Map(
    initiatives.map((initiative) => [
      initiative.id,
      initiative.parentInitiativeId,
    ]),
  );

  let cursor: string | null | undefined = parentInitiativeId;
  const visited = new Set<string>();

  while (cursor) {
    if (cursor === childInitiativeId) {
      return {
        ok: false as const,
        error: CIRCULAR_HIERARCHY_ERROR,
      };
    }

    if (visited.has(cursor)) {
      return {
        ok: false as const,
        error: CIRCULAR_HIERARCHY_ERROR,
      };
    }

    visited.add(cursor);
    cursor = parentById.get(cursor);
  }

  return { ok: true as const };
}
