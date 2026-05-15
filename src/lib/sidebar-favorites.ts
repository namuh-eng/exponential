export const SIDEBAR_FAVORITES_CHANGED_EVENT =
  "whetline:sidebar-favorites-change";

export type SidebarFavoriteObjectType = "project" | "issue" | "view";

export interface StoredSidebarFavorite {
  objectType: SidebarFavoriteObjectType;
  objectId: string;
  createdAt: string;
}

export interface SidebarFavorite extends StoredSidebarFavorite {
  id: string;
  label: string;
  href: string;
  context: string | null;
}

const MAX_SIDEBAR_FAVORITES = 50;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function getSidebarFavoriteId(
  objectType: SidebarFavoriteObjectType,
  objectId: string,
) {
  return `${objectType}:${objectId}`;
}

export function isSidebarFavoriteObjectType(
  value: unknown,
): value is SidebarFavoriteObjectType {
  return value === "project" || value === "issue" || value === "view";
}

function normalizeStoredFavorite(value: unknown): StoredSidebarFavorite | null {
  const parsed = asRecord(value);
  if (
    !isSidebarFavoriteObjectType(parsed.objectType) ||
    typeof parsed.objectId !== "string" ||
    parsed.objectId.trim() === ""
  ) {
    return null;
  }

  return {
    objectType: parsed.objectType,
    objectId: parsed.objectId,
    createdAt:
      typeof parsed.createdAt === "string"
        ? parsed.createdAt
        : new Date(0).toISOString(),
  };
}

export function readSidebarFavoritesFromUserSettings(
  settings: unknown,
  workspaceId: string,
): StoredSidebarFavorite[] {
  const parsed = asRecord(settings);
  const byWorkspace = asRecord(parsed.sidebarFavoritesByWorkspace);
  const rawFavorites = byWorkspace[workspaceId];
  if (!Array.isArray(rawFavorites)) {
    return [];
  }

  const seen = new Set<string>();
  const favorites: StoredSidebarFavorite[] = [];

  for (const rawFavorite of rawFavorites) {
    const favorite = normalizeStoredFavorite(rawFavorite);
    if (!favorite) continue;

    const favoriteId = getSidebarFavoriteId(
      favorite.objectType,
      favorite.objectId,
    );
    if (seen.has(favoriteId)) continue;

    seen.add(favoriteId);
    favorites.push(favorite);
  }

  return favorites.slice(0, MAX_SIDEBAR_FAVORITES);
}

export function writeSidebarFavoritesToUserSettings(
  settings: unknown,
  workspaceId: string,
  favorites: StoredSidebarFavorite[],
) {
  const parsed = asRecord(settings);
  const byWorkspace = asRecord(parsed.sidebarFavoritesByWorkspace);

  return {
    ...parsed,
    sidebarFavoritesByWorkspace: {
      ...byWorkspace,
      [workspaceId]: favorites.slice(0, MAX_SIDEBAR_FAVORITES),
    },
  };
}

export function favoriteExists(
  favorites: StoredSidebarFavorite[],
  objectType: SidebarFavoriteObjectType,
  objectId: string,
) {
  return favorites.some(
    (favorite) =>
      favorite.objectType === objectType && favorite.objectId === objectId,
  );
}
