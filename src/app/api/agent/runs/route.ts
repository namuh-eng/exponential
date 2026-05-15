import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { createAgentRun, listAgentRuns } from "@/lib/agent-runs";
import { requireApiSession } from "@/lib/api-auth";
import { NextResponse } from "next/server";

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  return NextResponse.json({
    runs: listAgentRuns(workspaceId),
    canCreateRuns: true,
  });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = normalizeString(body.title);
  const prompt = normalizeString(body.prompt);
  const teamKey = normalizeString(body.teamKey);
  const context = normalizeString(body.context);

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  if (prompt.length < 12) {
    return NextResponse.json(
      { error: "Describe the task in at least 12 characters" },
      { status: 400 },
    );
  }

  const run = createAgentRun(workspaceId, {
    title,
    prompt,
    teamKey,
    context,
    owner: session.user.name ?? session.user.email ?? "You",
  });

  return NextResponse.json({ run }, { status: 201 });
}
