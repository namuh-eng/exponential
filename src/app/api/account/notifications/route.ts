import {
  type AccountNotificationSettingsPatch,
  mergeAccountNotificationSettings,
  readAccountNotificationsFromUserSettings,
  writeAccountNotificationsToUserSettings,
} from "@/lib/account-notifications";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
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

  const currentUser = await findCurrentUser(session.user.id);
  if (!currentUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    accountNotifications: readAccountNotificationsFromUserSettings(
      currentUser.settings,
    ),
  });
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const currentUser = await findCurrentUser(session.user.id);
  if (!currentUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    accountNotifications?: AccountNotificationSettingsPatch;
  } | null;

  if (!body?.accountNotifications) {
    return NextResponse.json(
      { error: "accountNotifications is required" },
      { status: 400 },
    );
  }

  const currentSettings = readAccountNotificationsFromUserSettings(
    currentUser.settings,
  );
  const nextSettings = mergeAccountNotificationSettings(
    currentSettings,
    body.accountNotifications,
  );

  await db
    .update(user)
    .set({
      settings: writeAccountNotificationsToUserSettings(
        currentUser.settings,
        nextSettings,
      ),
      updatedAt: new Date(),
    })
    .where(eq(user.id, currentUser.id));

  return NextResponse.json({ accountNotifications: nextSettings });
}
