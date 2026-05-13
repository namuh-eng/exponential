import { WorkspaceTeamsDirectory } from "@/components/workspace-teams-directory";
import { auth } from "@/lib/auth";
import { getWorkspaceTeamsDirectory } from "@/lib/workspace-directory";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

export default async function TeamsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const data = await getWorkspaceTeamsDirectory(session.user.id);
  if (!data) {
    notFound();
  }

  return <WorkspaceTeamsDirectory teams={data.teams} />;
}
