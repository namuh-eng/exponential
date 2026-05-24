import { WorkspaceTeamsDirectory } from "@/components/workspace-teams-directory";
import { getWebSession } from "@/lib/web-session";
import { getWorkspaceTeamsDirectory } from "@/lib/workspace-directory";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

export default async function TeamsPage() {
  const session = await getWebSession(await headers());
  if (!session) {
    redirect("/login");
  }

  const data = await getWorkspaceTeamsDirectory(session.user.id);
  if (!data) {
    notFound();
  }

  return (
    <WorkspaceTeamsDirectory
      canManageTeams={data.canManageTeams}
      teams={data.teams}
      viewerRole={data.viewerRole}
    />
  );
}
