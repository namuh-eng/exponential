import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { type ApiSession, requireApiSession } from "@/lib/api-auth";
import {
  addCustomEmojiToWorkspaceSettings,
  readCustomEmojisFromWorkspaceSettings,
  validateCustomEmojiInput,
} from "@/lib/custom-emojis";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import {
  createHeadlessCustomEmojisClient,
  headlessCustomEmojisEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function getWorkspaceId(session: ApiSession) {
  if ("apiKey" in session) return session.apiKey.workspaceId;
  return resolveActiveWorkspaceId(session.user.id);
}

async function findWorkspace(workspaceId: string) {
  const [currentWorkspace] = await db
    .select({ id: workspace.id, settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return currentWorkspace ?? null;
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const workspaceId = await getWorkspaceId(session);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  if (!("apiKey" in session) && headlessCustomEmojisEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessCustomEmojisClient(token);
    const { data, error, response } = await client.GET("/custom-emojis");
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const currentWorkspace = await findWorkspace(workspaceId);
  if (!currentWorkspace) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  return NextResponse.json({
    emojis: readCustomEmojisFromWorkspaceSettings(currentWorkspace.settings),
  });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const workspaceId = await getWorkspaceId(session);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const currentWorkspace = await findWorkspace(workspaceId);
  if (!currentWorkspace) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    imageUrl?: unknown;
  } | null;

  if (!("apiKey" in session) && headlessCustomEmojisEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessCustomEmojisClient(token);
    const { data, error, response } = await client.POST("/custom-emojis", {
      body: body as never,
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const input = validateCustomEmojiInput({
    name: body?.name,
    imageUrl: body?.imageUrl,
  });
  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const emoji = {
    id: crypto.randomUUID(),
    name: input.name,
    imageUrl: input.imageUrl,
    createdAt: new Date().toISOString(),
  };
  const update = addCustomEmojiToWorkspaceSettings(
    currentWorkspace.settings,
    emoji,
  );
  if ("error" in update) {
    const updateError = update.error ?? "Unable to add custom emoji";
    return NextResponse.json(
      { error: updateError },
      { status: updateError.includes("exists") ? 409 : 400 },
    );
  }

  await db
    .update(workspace)
    .set({ settings: update.settings, updatedAt: new Date() })
    .where(eq(workspace.id, currentWorkspace.id));
  return NextResponse.json({ emoji }, { status: 201 });
}
