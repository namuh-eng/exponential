import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import {
  createHeadlessProjectUpdatesClient,
  headlessProjectUpdatesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import {
  buildProjectUpdateConfiguration,
  readProjectUpdateConfigurations,
  validateProjectUpdateInput,
  writeProjectUpdateConfigurations,
} from "@/lib/project-update-settings";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function hasApiKeyWorkspace(
  session: Awaited<ReturnType<typeof requireApiSession>>["session"],
): session is NonNullable<typeof session> & {
  apiKey: { workspaceId: string };
} {
  return Boolean(session && "apiKey" in session);
}

async function resolveWorkspaceId(
  session: NonNullable<
    Awaited<ReturnType<typeof requireApiSession>>["session"]
  >,
  request: Request,
) {
  if (hasApiKeyWorkspace(session)) {
    return session.apiKey.workspaceId;
  }

  return resolveRequestWorkspaceId(session.user.id, request);
}

async function loadWorkspaceSettings(workspaceId: string) {
  const [record] = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  return record?.settings;
}

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveWorkspaceId(session, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  if (headlessProjectUpdatesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessProjectUpdatesClient(token);
    const { data, error, response } = await client.GET("/project-updates");
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const settings = await loadWorkspaceSettings(workspaceId);
  return NextResponse.json({
    configurations: readProjectUpdateConfigurations(settings),
  });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveWorkspaceId(session, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (headlessProjectUpdatesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessProjectUpdatesClient(token);
    const { data, error, response } = await client.POST("/project-updates", {
      body: body as never,
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const validation = validateProjectUpdateInput(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, field: validation.field },
      { status: 400 },
    );
  }

  const settings = await loadWorkspaceSettings(workspaceId);
  const configurations = readProjectUpdateConfigurations(settings);
  const configuration = buildProjectUpdateConfiguration(validation.value);
  const nextConfigurations = [...configurations, configuration];

  await db
    .update(workspace)
    .set({
      settings: writeProjectUpdateConfigurations(settings, nextConfigurations),
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, workspaceId));

  return NextResponse.json({ configuration }, { status: 201 });
}
