import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { workspaceIntegration } from "@/lib/db/schema";
import {
  INTEGRATION_CATALOG,
  canManageIntegrations,
  getWorkspaceAccess,
  isSlackInstallConfigured,
} from "@/lib/workspace-integrations";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function setupRequirement(provider: string) {
  if (provider === "slack" && !isSlackInstallConfigured()) {
    return {
      type: "configuration_required",
      message:
        "Slack OAuth credentials are not configured. Add AUTH_SLACK_ID and AUTH_SLACK_SECRET to enable installation.",
    };
  }
  if (provider === "github" || provider === "zendesk") {
    return {
      type: "configuration_required",
      message: `${provider === "github" ? "GitHub" : "Zendesk"} setup is not configured in this environment yet.`,
    };
  }
  return null;
}

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  const rows = await db
    .select({
      id: workspaceIntegration.id,
      provider: workspaceIntegration.provider,
      status: workspaceIntegration.status,
      displayName: workspaceIntegration.displayName,
      externalId: workspaceIntegration.externalId,
      connectedAt: workspaceIntegration.connectedAt,
    })
    .from(workspaceIntegration)
    .where(eq(workspaceIntegration.workspaceId, access.workspaceId));

  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  const canManage = canManageIntegrations(access.role);

  return NextResponse.json({
    canManageIntegrations: canManage,
    integrations: INTEGRATION_CATALOG.map((catalogItem) => {
      const connected = byProvider.get(catalogItem.provider);
      const requirement = connected
        ? null
        : setupRequirement(catalogItem.provider);
      return {
        ...catalogItem,
        id: connected?.id ?? null,
        status:
          connected?.status ??
          (requirement ? "configuration_required" : "not_connected"),
        displayName: connected?.displayName ?? null,
        externalId: connected?.externalId ?? null,
        connectedAt: connected?.connectedAt
          ? new Date(connected.connectedAt).toISOString()
          : null,
        setupRequirement: requirement,
        actions: {
          canConnect: canManage && !connected && !requirement,
          canManage: canManage && Boolean(connected),
          canDisconnect: canManage && Boolean(connected),
        },
      };
    }),
  });
}

export async function DELETE(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }
  if (!canManageIntegrations(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  if (!provider) {
    return NextResponse.json(
      { error: "Provider is required" },
      { status: 400 },
    );
  }

  await db
    .delete(workspaceIntegration)
    .where(
      and(
        eq(workspaceIntegration.workspaceId, access.workspaceId),
        eq(workspaceIntegration.provider, provider),
      ),
    );
  return NextResponse.json({ success: true });
}
