import type { IssuesResponse } from "@/app/(app)/team/[key]/team-issues-client";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { createServerApiClient } from "@/lib/server-api-client";

// Server-side fetch of a team's grouped issues for SSR. Returning null lets the
// client component fall back to its own /api fetch + error handling, so a server
// miss degrades to today's behavior rather than breaking the page.
export async function getTeamIssues(
  userId: string,
  key: string,
): Promise<IssuesResponse | null> {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const client = await createServerApiClient();
  const result = await client.GET("/teams/{key}/issues", {
    params: { path: { key } },
    headers: { "x-workspace-id": workspaceId },
  });

  if (!result.response.ok || !result.data) {
    return null;
  }

  // The OpenAPI schema types groups/filterOptions loosely (additionalProperties:
  // true), so narrow the payload to the shape the client renders via a runtime
  // guard rather than an unchecked cast. A shape miss degrades to a client fetch.
  const candidate: unknown = result.data;
  return isIssuesResponse(candidate) ? candidate : null;
}

function isIssuesResponse(value: unknown): value is IssuesResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.team === "object" &&
    record.team !== null &&
    Array.isArray(record.groups) &&
    typeof record.filterOptions === "object" &&
    record.filterOptions !== null
  );
}
