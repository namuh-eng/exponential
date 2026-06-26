import type { InitiativesResponse } from "@/app/(app)/initiatives/initiatives-client";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { createServerApiClient } from "@/lib/server-api-client";

// Server-side fetch of workspace initiatives for SSR. Returning null lets the
// client component fall back to its own /api fetch + error handling, so a
// server miss degrades to today's behavior rather than breaking the page.
export async function getInitiatives(
  userId: string,
): Promise<InitiativesResponse | null> {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const client = await createServerApiClient();
  const result = await client.GET("/initiatives", {
    headers: { "x-workspace-id": workspaceId },
  });

  if (!result.response.ok || !result.data) {
    return null;
  }

  // Narrow the payload to the shape the client renders via a runtime guard
  // rather than an unchecked cast. A shape miss degrades to a client fetch.
  const candidate: unknown = result.data;
  return isInitiativesResponse(candidate) ? candidate : null;
}

function isInitiativesResponse(value: unknown): value is InitiativesResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.initiatives);
}
