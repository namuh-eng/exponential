import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { createServerApiClient } from "@/lib/server-api-client";

// Server-side fetch of the workspace members list for SSR. Returning null lets
// the client component fall back to its own /api fetch + error handling, so a
// server miss degrades to the existing behavior rather than breaking the page.

export interface WorkspaceMember {
  id: string;
  kind: "member" | "invitation";
  userId: string | null;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "admin" | "member" | "guest";
  status: "active" | "pending";
  teams: { id: string; name: string; key: string }[];
  joinedAt: string;
  lastSeenAt: string | null;
}

export interface WorkspaceMembersResponse {
  workspaceId: string;
  currentUserId: string | null;
  viewerRole: string;
  canInviteMembers?: boolean;
  members: WorkspaceMember[];
}

export async function getWorkspaceMembers(
  userId: string,
): Promise<WorkspaceMembersResponse | null> {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const client = await createServerApiClient();
  const result = await client.GET("/workspaces/members", {
    headers: { "x-workspace-id": workspaceId },
  });

  if (!result.response.ok || !result.data) {
    return null;
  }

  // The OpenAPI schema types the members array loosely, so narrow the payload
  // to the shape the client renders via a runtime guard rather than an unchecked
  // cast. A shape miss degrades gracefully to a client-side fetch.
  const candidate: unknown = result.data;
  return isWorkspaceMembersResponse(candidate) ? candidate : null;
}

function isWorkspaceMembersResponse(
  value: unknown,
): value is WorkspaceMembersResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.workspaceId === "string" &&
    typeof record.viewerRole === "string" &&
    Array.isArray(record.members)
  );
}
