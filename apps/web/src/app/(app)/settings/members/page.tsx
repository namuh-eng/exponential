import { getWebSession } from "@/lib/web-session";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MembersClient } from "./members-client";

export default async function Page() {
  const session = await getWebSession(await headers());
  if (!session) {
    redirect("/login");
  }

  const initialData = await getWorkspaceMembers(session.user.id);
  return <MembersClient initialData={initialData} />;
}
