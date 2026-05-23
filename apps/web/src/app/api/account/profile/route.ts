import {
  isValidAccountProfileTimezone,
  readAccountProfileFromUserSettings,
  sanitizeAccountProfileMetadata,
  sanitizeAccountProfileUsername,
  writeAccountProfileToUserSettings,
} from "@/lib/account-profile";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { user, workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function findCurrentUser(userId: string) {
  const [currentUser] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      settings: user.settings,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return currentUser ?? null;
}

function isSupportedProfileImage(value: string) {
  return (
    /^https?:\/\//.test(value) ||
    /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(value)
  );
}

async function buildProfileResponse(userId: string) {
  const currentUser = await findCurrentUser(userId);
  if (!currentUser) {
    return null;
  }

  const accountProfile = readAccountProfileFromUserSettings(
    currentUser.settings,
  );
  const activeWorkspaceId = await resolveActiveWorkspaceId(userId);
  const [currentWorkspace] = activeWorkspaceId
    ? await db
        .select({
          id: workspace.id,
          name: workspace.name,
        })
        .from(workspace)
        .where(eq(workspace.id, activeWorkspaceId))
        .limit(1)
    : [];

  return {
    currentUser,
    profile: {
      name: currentUser.name,
      email: currentUser.email,
      username: accountProfile.username,
      pronouns: accountProfile.pronouns,
      title: accountProfile.title,
      location: accountProfile.location,
      timezone: accountProfile.timezone,
      showLocalTime: accountProfile.showLocalTime,
      image: currentUser.image,
    },
    workspaceAccess: {
      currentWorkspaceId: currentWorkspace?.id ?? null,
      currentWorkspaceName: currentWorkspace?.name ?? null,
    },
  };
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const payload = await buildProfileResponse(session.user.id);
  if (!payload) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    profile: payload.profile,
    workspaceAccess: payload.workspaceAccess,
  });
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const payload = await buildProfileResponse(session.user.id);
  if (!payload) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    username?: unknown;
    image?: unknown;
    pronouns?: unknown;
    title?: unknown;
    location?: unknown;
    timezone?: unknown;
    showLocalTime?: unknown;
  } | null;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "Full name is required" },
      { status: 400 },
    );
  }

  const username = sanitizeAccountProfileUsername(body?.username);
  if (username.includes(" ")) {
    return NextResponse.json(
      { error: "Username must be a single word" },
      { status: 400 },
    );
  }

  if (!isValidAccountProfileTimezone(body?.timezone)) {
    return NextResponse.json(
      { error: "Timezone must be a valid IANA timezone" },
      { status: 400 },
    );
  }

  const metadata = sanitizeAccountProfileMetadata({
    pronouns: body?.pronouns,
    title: body?.title,
    location: body?.location,
    timezone: body?.timezone,
    showLocalTime: body?.showLocalTime,
  });

  const rawImage =
    typeof body?.image === "string" ? body.image.trim() : body?.image;
  if (
    typeof rawImage === "string" &&
    rawImage.length > 2_000_000 &&
    rawImage.startsWith("data:image/")
  ) {
    return NextResponse.json(
      { error: "Profile image is too large" },
      { status: 400 },
    );
  }

  if (
    rawImage !== undefined &&
    rawImage !== null &&
    rawImage !== "" &&
    (typeof rawImage !== "string" || !isSupportedProfileImage(rawImage))
  ) {
    return NextResponse.json(
      { error: "Unsupported profile image" },
      { status: 400 },
    );
  }

  const image =
    rawImage === undefined
      ? payload.currentUser.image
      : typeof rawImage === "string" && rawImage
        ? rawImage
        : null;

  await db
    .update(user)
    .set({
      name,
      image,
      settings: writeAccountProfileToUserSettings(
        payload.currentUser.settings,
        {
          username,
          ...metadata,
        },
      ),
      updatedAt: new Date(),
    })
    .where(eq(user.id, payload.currentUser.id));

  return NextResponse.json({
    profile: {
      name,
      email: payload.currentUser.email,
      username,
      ...metadata,
      image,
    },
    workspaceAccess: payload.workspaceAccess,
  });
}
