import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { workspaceIntegration } from "@/lib/db/schema";
import {
  hasActiveNotionPreviewUsers,
  revokeNotionPreviewUser,
} from "@/lib/notion-rich-previews";
import { getWorkspaceAccess } from "@/lib/workspace-integrations";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  const [integration] = await db
    .select({
      id: workspaceIntegration.id,
      metadata: workspaceIntegration.metadata,
    })
    .from(workspaceIntegration)
    .where(
      and(
        eq(workspaceIntegration.workspaceId, access.workspaceId),
        eq(workspaceIntegration.provider, "notion"),
      ),
    )
    .limit(1);

  if (!integration) {
    return NextResponse.json({ success: true, provider: "notion" });
  }

  const metadata = revokeNotionPreviewUser(
    integration.metadata,
    session.user.id,
  );

  await db
    .update(workspaceIntegration)
    .set({
      metadata,
      status: hasActiveNotionPreviewUsers(metadata)
        ? "connected"
        : "disconnected",
      updatedAt: new Date(),
    })
    .where(eq(workspaceIntegration.id, integration.id));

  return NextResponse.json({ success: true, provider: "notion" });
}
