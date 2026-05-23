import { WorkspaceMembersDirectory } from "@/components/workspace-members-directory";
import { auth } from "@/lib/auth";
import { getWorkspaceMembersDirectory } from "@/lib/workspace-directory";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

export default async function MembersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const data = await getWorkspaceMembersDirectory(session.user.id);
  if (!data) {
    notFound();
  }

  return <WorkspaceMembersDirectory members={data.members} />;
}
