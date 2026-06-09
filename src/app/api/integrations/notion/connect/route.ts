import { requireApiSession } from "@/lib/api-auth";
import { getRequestAppUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import { workspaceIntegration } from "@/lib/db/schema";
import {
  createNotionPreviewToken,
  hashNotionPreviewToken,
  upsertNotionPreviewUser,
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
  const token = createNotionPreviewToken();
  const now = new Date();
  const [existing] = await db
    .select({ metadata: workspaceIntegration.metadata })
    .from(workspaceIntegration)
    .where(
      and(
        eq(workspaceIntegration.workspaceId, access.workspaceId),
        eq(workspaceIntegration.provider, "notion"),
      ),
    )
    .limit(1);

  const metadata = upsertNotionPreviewUser(
    existing?.metadata,
    session.user.id,
    hashNotionPreviewToken(token),
    now.toISOString(),
  );

  await db
    .insert(workspaceIntegration)
    .values({
      workspaceId: access.workspaceId,
      provider: "notion",
      status: "connected",
      externalId: access.workspaceSlug,
      displayName: "Notion rich previews",
      metadata,
      connectedByUserId: session.user.id,
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workspaceIntegration.workspaceId, workspaceIntegration.provider],
      set: {
        status: "connected",
        externalId: access.workspaceSlug,
        displayName: "Notion rich previews",
        metadata,
        connectedByUserId: session.user.id,
        connectedAt: now,
        updatedAt: now,
      },
    });

  return NextResponse.json({
    success: true,
    provider: "notion",
    workspaceSlug: access.workspaceSlug,
    previewEndpoint: new URL(
      "/api/integrations/notion/unfurl",
      getRequestAppUrl(request),
    ).toString(),
    previewToken: token,
  });
}
