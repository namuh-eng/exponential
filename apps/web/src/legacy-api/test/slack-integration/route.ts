import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { workspaceIntegration } from "@/lib/db/schema";
import {
  headlessAuthProvidersEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { getWorkspaceAccess } from "@/lib/workspace-integrations";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.PLAYWRIGHT_TEST !== "true"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (headlessAuthProvidersEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: access.workspaceId,
    });
    const upstream = await fetch(
      `${process.env.EXPONENTIAL_API_URL ?? "http://localhost:3016/v1"}/test/slack-integration`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    );
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  }

  const now = new Date();
  const [integration] = await db
    .insert(workspaceIntegration)
    .values({
      workspaceId: access.workspaceId,
      provider: "slack",
      status: "connected",
      displayName: "E2E Slack Workspace",
      externalId: `T_${access.workspaceSlug}`,
      metadata: { createdBy: "playwright" },
      connectedByUserId: session.user.id,
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workspaceIntegration.workspaceId, workspaceIntegration.provider],
      set: {
        status: "connected",
        displayName: "E2E Slack Workspace",
        connectedByUserId: session.user.id,
        connectedAt: now,
        updatedAt: now,
      },
    })
    .returning({ id: workspaceIntegration.id });

  return NextResponse.json({ success: true, id: integration.id });
}

export async function DELETE(request: Request) {
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.PLAYWRIGHT_TEST !== "true"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (headlessAuthProvidersEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: access.workspaceId,
    });
    const upstream = await fetch(
      `${process.env.EXPONENTIAL_API_URL ?? "http://localhost:3016/v1"}/test/slack-integration`,
      { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
    );
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  }

  await db
    .delete(workspaceIntegration)
    .where(
      and(
        eq(workspaceIntegration.workspaceId, access.workspaceId),
        eq(workspaceIntegration.provider, "slack"),
      ),
    );
  return NextResponse.json({ success: true });
}
