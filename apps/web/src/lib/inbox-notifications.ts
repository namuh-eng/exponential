import type { NotificationsResponse } from "@/components/inbox-client";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { createServerApiClient } from "@/lib/server-api-client";

// Server-side fetch of the notifications list for SSR seeding. Returning null
// lets the client component fall back to its own /api/notifications fetch, so a
// server miss degrades to today's behavior rather than breaking the page.
export async function getInboxNotifications(
  userId: string,
): Promise<NotificationsResponse | null> {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const client = await createServerApiClient();
  const result = await client.GET("/notifications", {
    headers: { "x-workspace-id": workspaceId },
  });

  if (!result.response.ok || !result.data) {
    return null;
  }

  // Guard the response shape before trusting it; a mismatch degrades to a
  // client-side fetch rather than a broken render.
  const candidate: unknown = result.data;
  return isNotificationsResponse(candidate) ? candidate : null;
}

function isNotificationsResponse(
  value: unknown,
): value is NotificationsResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.notifications) &&
    typeof record.unreadCount === "number"
  );
}
