import { getMyIssues } from "@/lib/my-issues";
import { getWebSession } from "@/lib/web-session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MyIssuesClient } from "./my-issues-client";

export default async function MyIssuesTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  const session = await getWebSession(await headers());
  if (!session) {
    redirect("/login");
  }

  const initialData = await getMyIssues(session.user.id, tab);

  return <MyIssuesClient initialData={initialData} />;
}
