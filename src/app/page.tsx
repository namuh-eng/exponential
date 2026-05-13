import { readAccountPreferencesFromUserSettings } from "@/lib/account-preferences";
import { autoJoinWorkspaceForApprovedDomain } from "@/lib/approved-domain-auto-join";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, team, user, workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  // Check if user has any workspaces
  const loadMemberships = () =>
    db
      .select({
        workspaceId: member.workspaceId,
        workspaceSlug: workspace.urlSlug,
      })
      .from(member)
      .innerJoin(workspace, eq(member.workspaceId, workspace.id))
      .where(eq(member.userId, session.user.id))
      .limit(1);

  let memberships = await loadMemberships();

  if (memberships.length === 0) {
    await autoJoinWorkspaceForApprovedDomain({
      userId: session.user.id,
      email: session.user.email,
    });
    memberships = await loadMemberships();

    if (memberships.length === 0) {
      redirect("/create-workspace");
    }
  }

  // Get the first team in the workspace to redirect to
  const teams = await db
    .select({ key: team.key })
    .from(team)
    .where(eq(team.workspaceId, memberships[0].workspaceId))
    .limit(1);

  const [currentUser] = await db
    .select({ settings: user.settings })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);
  const accountPreferences = readAccountPreferencesFromUserSettings(
    currentUser?.settings,
  );

  const workspaceBase = `/${memberships[0].workspaceSlug}`;

  if (accountPreferences.defaultHomeView === "inbox") {
    redirect(`${workspaceBase}/inbox`);
  }

  if (accountPreferences.defaultHomeView === "my-issues") {
    redirect(`${workspaceBase}/my-issues/assigned`);
  }

  if (teams.length > 0) {
    redirect(`${workspaceBase}/team/${teams[0].key}/all`);
  }

  redirect(`${workspaceBase}/team`);
}
