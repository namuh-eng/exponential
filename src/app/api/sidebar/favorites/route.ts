import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { customView, issue, project, team, user } from "@/lib/db/schema";
import {
  type SidebarFavorite,
  type SidebarFavoriteObjectType,
  type StoredSidebarFavorite,
  favoriteExists,
  getSidebarFavoriteId,
  isSidebarFavoriteObjectType,
  readSidebarFavoritesFromUserSettings,
  writeSidebarFavoritesToUserSettings,
} from "@/lib/sidebar-favorites";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

async function resolveWorkspaceId(
  session: Awaited<ReturnType<typeof requireApiSession>>["session"],
  request: Request,
) {
  if (!session) return null;
  if ("apiKey" in session) return session.apiKey.workspaceId;
  return resolveRequestWorkspaceId(session.user.id, request);
}

async function findCurrentUser(userId: string) {
  const [currentUser] = await db
    .select({ id: user.id, settings: user.settings })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return currentUser ?? null;
}

async function hydrateFavorites(
  workspaceId: string,
  favorites: StoredSidebarFavorite[],
): Promise<SidebarFavorite[]> {
  const projectIds = favorites
    .filter((favorite) => favorite.objectType === "project")
    .map((favorite) => favorite.objectId);
  const issueIds = favorites
    .filter((favorite) => favorite.objectType === "issue")
    .map((favorite) => favorite.objectId);
  const viewIds = favorites
    .filter((favorite) => favorite.objectType === "view")
    .map((favorite) => favorite.objectId);

  const [projectRows, issueRows, viewRows] = await Promise.all([
    projectIds.length > 0
      ? db
          .select({
            id: project.id,
            name: project.name,
            slug: project.slug,
            icon: project.icon,
          })
          .from(project)
          .where(
            and(
              eq(project.workspaceId, workspaceId),
              inArray(project.id, projectIds),
            ),
          )
      : Promise.resolve([]),
    issueIds.length > 0
      ? db
          .select({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            teamKey: team.key,
          })
          .from(issue)
          .innerJoin(team, eq(issue.teamId, team.id))
          .where(
            and(eq(team.workspaceId, workspaceId), inArray(issue.id, issueIds)),
          )
      : Promise.resolve([]),
    viewIds.length > 0
      ? db
          .select({
            id: customView.id,
            name: customView.name,
            teamKey: team.key,
          })
          .from(customView)
          .leftJoin(team, eq(customView.teamId, team.id))
          .where(
            and(
              eq(customView.workspaceId, workspaceId),
              inArray(customView.id, viewIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const projectsById = new Map(projectRows.map((row) => [row.id, row]));
  const issuesById = new Map(issueRows.map((row) => [row.id, row]));
  const viewsById = new Map(viewRows.map((row) => [row.id, row]));

  return favorites.flatMap((favorite): SidebarFavorite[] => {
    if (favorite.objectType === "project") {
      const row = projectsById.get(favorite.objectId);
      if (!row) return [];
      return [
        {
          ...favorite,
          id: getSidebarFavoriteId(favorite.objectType, favorite.objectId),
          label: row.name,
          href: `/project/${row.slug}`,
          context: "Project",
        },
      ];
    }

    if (favorite.objectType === "issue") {
      const row = issuesById.get(favorite.objectId);
      if (!row) return [];
      return [
        {
          ...favorite,
          id: getSidebarFavoriteId(favorite.objectType, favorite.objectId),
          label: row.identifier,
          href: `/issue/${row.identifier}`,
          context: row.title,
        },
      ];
    }

    const row = viewsById.get(favorite.objectId);
    if (!row) return [];
    return [
      {
        ...favorite,
        id: getSidebarFavoriteId(favorite.objectType, favorite.objectId),
        label: row.name,
        href: row.teamKey ? `/team/${row.teamKey}/views` : "/views",
        context: row.teamKey ? `${row.teamKey} view` : "Workspace view",
      },
    ];
  });
}

async function validateFavoriteTarget(
  workspaceId: string,
  objectType: SidebarFavoriteObjectType,
  objectId: string,
) {
  if (objectType === "project") {
    const [row] = await db
      .select({ id: project.id })
      .from(project)
      .where(
        and(eq(project.workspaceId, workspaceId), eq(project.id, objectId)),
      )
      .limit(1);
    return Boolean(row);
  }

  if (objectType === "issue") {
    const [row] = await db
      .select({ id: issue.id })
      .from(issue)
      .innerJoin(team, eq(issue.teamId, team.id))
      .where(and(eq(team.workspaceId, workspaceId), eq(issue.id, objectId)))
      .limit(1);
    return Boolean(row);
  }

  const [row] = await db
    .select({ id: customView.id })
    .from(customView)
    .where(
      and(eq(customView.workspaceId, workspaceId), eq(customView.id, objectId)),
    )
    .limit(1);
  return Boolean(row);
}

function parseFavoriteInput(value: unknown) {
  const body =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const objectType = body.objectType;
  const objectId = body.objectId;

  if (
    !isSidebarFavoriteObjectType(objectType) ||
    typeof objectId !== "string" ||
    !objectId.trim()
  ) {
    return null;
  }

  return { objectType, objectId };
}

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const workspaceId = await resolveWorkspaceId(session, request);
  if (!workspaceId) return NextResponse.json({ favorites: [] });

  const currentUser = await findCurrentUser(session.user.id);
  if (!currentUser)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const storedFavorites = readSidebarFavoritesFromUserSettings(
    currentUser.settings,
    workspaceId,
  );
  const favorites = await hydrateFavorites(workspaceId, storedFavorites);
  return NextResponse.json({ favorites });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const workspaceId = await resolveWorkspaceId(session, request);
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });

  const currentUser = await findCurrentUser(session.user.id);
  if (!currentUser)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const input = parseFavoriteInput(await request.json().catch(() => null));
  if (!input)
    return NextResponse.json(
      { error: "objectType and objectId are required" },
      { status: 400 },
    );

  const targetExists = await validateFavoriteTarget(
    workspaceId,
    input.objectType,
    input.objectId,
  );
  if (!targetExists)
    return NextResponse.json(
      { error: "Favorite target not found" },
      { status: 404 },
    );

  const currentFavorites = readSidebarFavoritesFromUserSettings(
    currentUser.settings,
    workspaceId,
  );
  const nextFavorites = favoriteExists(
    currentFavorites,
    input.objectType,
    input.objectId,
  )
    ? currentFavorites
    : [
        ...currentFavorites,
        {
          objectType: input.objectType,
          objectId: input.objectId,
          createdAt: new Date().toISOString(),
        },
      ];

  await db
    .update(user)
    .set({
      settings: writeSidebarFavoritesToUserSettings(
        currentUser.settings,
        workspaceId,
        nextFavorites,
      ),
      updatedAt: new Date(),
    })
    .where(eq(user.id, currentUser.id));

  return NextResponse.json(
    { favorites: await hydrateFavorites(workspaceId, nextFavorites) },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const workspaceId = await resolveWorkspaceId(session, request);
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });

  const currentUser = await findCurrentUser(session.user.id);
  if (!currentUser)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    orderedIds?: unknown;
  } | null;
  const orderedIds = Array.isArray(body?.orderedIds)
    ? body.orderedIds.filter((id): id is string => typeof id === "string")
    : null;
  if (!orderedIds)
    return NextResponse.json(
      { error: "orderedIds is required" },
      { status: 400 },
    );

  const currentFavorites = readSidebarFavoritesFromUserSettings(
    currentUser.settings,
    workspaceId,
  );
  const byId = new Map(
    currentFavorites.map((favorite) => [
      getSidebarFavoriteId(favorite.objectType, favorite.objectId),
      favorite,
    ]),
  );
  const nextFavorites = [
    ...orderedIds.flatMap((id) => {
      const favorite = byId.get(id);
      if (!favorite) return [];
      byId.delete(id);
      return [favorite];
    }),
    ...byId.values(),
  ];

  await db
    .update(user)
    .set({
      settings: writeSidebarFavoritesToUserSettings(
        currentUser.settings,
        workspaceId,
        nextFavorites,
      ),
      updatedAt: new Date(),
    })
    .where(eq(user.id, currentUser.id));

  return NextResponse.json({
    favorites: await hydrateFavorites(workspaceId, nextFavorites),
  });
}

export async function DELETE(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const workspaceId = await resolveWorkspaceId(session, request);
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });

  const currentUser = await findCurrentUser(session.user.id);
  if (!currentUser)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const url = new URL(request.url);
  const objectType = url.searchParams.get("objectType");
  const objectId = url.searchParams.get("objectId");
  if (!isSidebarFavoriteObjectType(objectType) || !objectId) {
    return NextResponse.json(
      { error: "objectType and objectId are required" },
      { status: 400 },
    );
  }

  const currentFavorites = readSidebarFavoritesFromUserSettings(
    currentUser.settings,
    workspaceId,
  );
  const nextFavorites = currentFavorites.filter(
    (favorite) =>
      favorite.objectType !== objectType || favorite.objectId !== objectId,
  );

  await db
    .update(user)
    .set({
      settings: writeSidebarFavoritesToUserSettings(
        currentUser.settings,
        workspaceId,
        nextFavorites,
      ),
      updatedAt: new Date(),
    })
    .where(eq(user.id, currentUser.id));

  return NextResponse.json({
    favorites: await hydrateFavorites(workspaceId, nextFavorites),
  });
}
