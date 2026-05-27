import { LandingPage } from "@/components/landing-page";
import { readAccountPreferencesFromUserSettings } from "@/lib/account-preferences";
import { requireApiData } from "@/lib/api-response";
import { autoJoinWorkspaceForApprovedDomain } from "@/lib/approved-domain-auto-join";
import { createServerApiClient } from "@/lib/server-api-client";
import { getWebSession } from "@/lib/web-session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getWebSession(await headers());

  if (!session) {
    return <LandingPage />;
  }

  const client = await createServerApiClient();
  const loadMemberships = async () =>
    requireApiData(await client.GET("/workspaces"), "List workspaces");

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

  const activeWorkspace = memberships[0];
  const [teamsResponse, preferencesResponse] = await Promise.all([
    client.GET("/teams", {
      headers: { "x-workspace-id": activeWorkspace.workspaceId },
    }),
    client.GET("/account/preferences", {
      headers: { "x-workspace-id": activeWorkspace.workspaceId },
    }),
  ]);
  const teams = requireApiData(teamsResponse, "List teams").teams;
  const preferences = requireApiData(
    preferencesResponse,
    "Get account preferences",
  );
  const accountPreferences = readAccountPreferencesFromUserSettings({
    accountPreferences: preferences.accountPreferences,
  });

  const workspaceBase = `/${activeWorkspace.workspaceSlug}`;

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
