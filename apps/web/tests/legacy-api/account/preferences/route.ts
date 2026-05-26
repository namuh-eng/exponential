import {
  type AccountPreferencesPatch,
  mergeAccountPreferences,
  readAccountPreferencesFromUserSettings,
  writeAccountPreferencesToUserSettings,
} from "@/lib/account-preferences";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import {
  createHeadlessAccountPreferencesClient,
  headlessAccountPreferencesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function findCurrentUser(userId: string) {
  const [currentUser] = await db
    .select({
      id: user.id,
      settings: user.settings,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return currentUser ?? null;
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  if (headlessAccountPreferencesEnabled()) {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (!workspaceId) {
      return NextResponse.json(
        { error: "No workspace found" },
        { status: 400 },
      );
    }
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessAccountPreferencesClient(token);
    const { data, error, response } = await client.GET("/account/preferences");
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const currentUser = await findCurrentUser(session.user.id);
  if (!currentUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    accountPreferences: readAccountPreferencesFromUserSettings(
      currentUser.settings,
    ),
  });
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  if (headlessAccountPreferencesEnabled()) {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (!workspaceId) {
      return NextResponse.json(
        { error: "No workspace found" },
        { status: 400 },
      );
    }
    const body = (await request.json().catch(() => null)) as {
      accountPreferences?: AccountPreferencesPatch;
    } | null;
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessAccountPreferencesClient(token);
    const { data, error, response } = await client.PATCH(
      "/account/preferences",
      { body: body as never },
    );
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const currentUser = await findCurrentUser(session.user.id);
  if (!currentUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    accountPreferences?: AccountPreferencesPatch;
  } | null;

  if (!body?.accountPreferences) {
    return NextResponse.json(
      { error: "accountPreferences is required" },
      { status: 400 },
    );
  }

  const currentPreferences = readAccountPreferencesFromUserSettings(
    currentUser.settings,
  );
  const nextPreferences = mergeAccountPreferences(
    currentPreferences,
    body.accountPreferences,
  );

  await db
    .update(user)
    .set({
      settings: writeAccountPreferencesToUserSettings(
        currentUser.settings,
        nextPreferences,
      ),
      updatedAt: new Date(),
    })
    .where(eq(user.id, currentUser.id));

  return NextResponse.json({ accountPreferences: nextPreferences });
}
