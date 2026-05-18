import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import {
  type IntegrationProvider,
  serializeIntegrations,
  updateWorkspaceIntegration,
} from "@/lib/integrations";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const providers = new Set(["github", "slack", "zendesk"]);
async function access(userId: string, workspaceIdOverride?: string) {
  const workspaceId =
    workspaceIdOverride ?? (await resolveActiveWorkspaceId(userId));
  if (!workspaceId) return null;
  const [row] = await db
    .select({ id: workspace.id, role: member.role })
    .from(workspace)
    .innerJoin(
      member,
      and(eq(member.workspaceId, workspace.id), eq(member.userId, userId)),
    )
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return row ?? null;
}
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const { provider } = await params;
  if (!providers.has(provider))
    return NextResponse.json(
      { error: "Unsupported integration" },
      { status: 404 },
    );
  if (provider === "zendesk")
    return NextResponse.json(
      {
        error:
          "Zendesk setup requires credentials that are not configured for this workspace.",
      },
      { status: 409 },
    );
  const row = await access(
    session.user.id,
    "apiKey" in session ? session.apiKey.workspaceId : undefined,
  );
  if (!row)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  if (row.role !== "owner" && row.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const settings = await updateWorkspaceIntegration(
    row.id,
    provider as IntegrationProvider,
    true,
  );
  return NextResponse.json({ integrations: serializeIntegrations(settings) });
}
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const { provider } = await params;
  if (!providers.has(provider))
    return NextResponse.json(
      { error: "Unsupported integration" },
      { status: 404 },
    );
  const row = await access(
    session.user.id,
    "apiKey" in session ? session.apiKey.workspaceId : undefined,
  );
  if (!row)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  if (row.role !== "owner" && row.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const settings = await updateWorkspaceIntegration(
    row.id,
    provider as IntegrationProvider,
    false,
  );
  return NextResponse.json({ integrations: serializeIntegrations(settings) });
}
