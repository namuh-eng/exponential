import { requireApiData } from "@/lib/api-response";
import { createServerApiClient } from "@/lib/server-api-client";

export async function autoJoinWorkspaceForApprovedDomain(input: {
  userId: string;
  email: string | null | undefined;
}) {
  if (!input.userId || !input.email) return null;
  const client = await createServerApiClient();
  const result = requireApiData(
    await client.POST("/workspaces/approved-domain-auto-join"),
    "Approved-domain auto-join",
  );
  return result.workspaceId;
}
