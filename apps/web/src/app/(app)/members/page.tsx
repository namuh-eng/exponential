import { WorkspaceMembersDirectory } from "@/components/workspace-members-directory";
import { getWebSession } from "@/lib/web-session";
import { getWorkspaceMembersDirectory } from "@/lib/workspace-directory";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

export default async function MembersPage() {
  const session = await getWebSession(await headers());
  if (!session) {
    redirect("/login");
  }

  const data = await getWorkspaceMembersDirectory(session.user.id);
  if (!data) {
    notFound();
  }

  return <WorkspaceMembersDirectory members={data.members} />;
}
