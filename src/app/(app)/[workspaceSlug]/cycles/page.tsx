import { CANONICAL_TEAM_KEY } from "@/lib/canonical-routes";
import { redirect } from "next/navigation";

export default async function WorkspaceCyclesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/team/${CANONICAL_TEAM_KEY}/cycles`);
}
