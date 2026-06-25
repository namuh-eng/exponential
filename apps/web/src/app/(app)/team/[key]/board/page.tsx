import { getTeamIssues } from "@/lib/team-issues";
import { getWebSession } from "@/lib/web-session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TeamBoardClient } from "../board-client";

export default async function TeamBoardPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const session = await getWebSession(await headers());
  if (!session) {
    redirect("/login");
  }

  const initialData = await getTeamIssues(session.user.id, key);

  return <TeamBoardClient initialData={initialData} />;
}
