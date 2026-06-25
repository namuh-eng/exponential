import type { ProjectsResponse } from "@/components/projects-page";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { createServerApiClient } from "@/lib/server-api-client";

// Server-side fetch of the workspace project list for SSR. Returning null lets
// the client component fall back to its own /api fetch + error handling, so a
// server miss degrades to the existing behavior rather than breaking the page.
export async function getProjects(
  userId: string,
): Promise<ProjectsResponse | null> {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const client = await createServerApiClient();
  const result = await client.GET("/projects", {
    headers: { "x-workspace-id": workspaceId },
  });

  if (!result.response.ok || !result.data) {
    return null;
  }

  // The OpenAPI schema types the projects array loosely, so narrow the payload
  // to the shape the client renders via a runtime guard rather than an unchecked
  // cast. A shape miss degrades gracefully to a client-side fetch.
  const candidate: unknown = result.data;
  return isProjectsResponse(candidate) ? candidate : null;
}

function isProjectsResponse(value: unknown): value is ProjectsResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.projects);
}
