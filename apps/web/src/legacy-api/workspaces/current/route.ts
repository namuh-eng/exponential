import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import {
  createHeadlessWorkspacesClient,
  headlessWorkspacesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import {
  MAX_WORKSPACE_NAME_LENGTH,
  validateWorkspaceName,
  validateWorkspaceSlug,
} from "@/lib/workspace-creation";
import { and, desc, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

const DEFAULT_REGION = "United States";
const DEFAULT_FISCAL_MONTH = "january";
const FISCAL_MONTHS = new Set([
  "january",
  "february",
  "march",
  "april",
  "july",
  "october",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isSupportedLogo(value: string) {
  return (
    /^https?:\/\//.test(value) ||
    /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(value)
  );
}

function readWorkspaceSettings(settings: unknown) {
  const parsed = asRecord(settings);
  const region =
    typeof parsed.region === "string" && parsed.region.trim()
      ? parsed.region
      : DEFAULT_REGION;
  const fiscalMonth =
    typeof parsed.fiscalMonth === "string" &&
    FISCAL_MONTHS.has(parsed.fiscalMonth)
      ? parsed.fiscalMonth
      : DEFAULT_FISCAL_MONTH;

  const plan = typeof parsed.plan === "string" ? parsed.plan : "free";
  const welcomeMessage =
    typeof parsed.welcomeMessage === "string" ? parsed.welcomeMessage : "";

  return {
    region,
    fiscalMonth,
    plan,
    welcomeMessage,
  };
}

async function findCurrentWorkspace(userId: string) {
  const activeWorkspaceId = await resolveActiveWorkspaceId(userId);
  if (!activeWorkspaceId) {
    return null;
  }

  const [currentWorkspace] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      urlSlug: workspace.urlSlug,
      logoUrl: workspace.logoUrl,
      settings: workspace.settings,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, userId),
        eq(member.workspaceId, activeWorkspaceId),
      ),
    )
    .limit(1);

  if (!currentWorkspace) {
    return null;
  }

  return {
    ...currentWorkspace,
    ...readWorkspaceSettings(currentWorkspace.settings),
  };
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const currentWorkspace = await findCurrentWorkspace(session.user.id);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (headlessWorkspacesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: currentWorkspace.id,
    });
    const client = createHeadlessWorkspacesClient(token);
    const { data, error, response } = await client.GET("/workspaces/current");
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  return NextResponse.json({
    workspace: {
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      urlSlug: currentWorkspace.urlSlug,
      logo: currentWorkspace.logoUrl,
      region: currentWorkspace.region,
      fiscalMonth: currentWorkspace.fiscalMonth,
      welcomeMessage: currentWorkspace.welcomeMessage,
      plan: currentWorkspace.plan,
    },
  });
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const currentWorkspace = await findCurrentWorkspace(session.user.id);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    urlSlug?: unknown;
    logo?: unknown;
    fiscalMonth?: unknown;
    welcomeMessage?: unknown;
  } | null;

  if (headlessWorkspacesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: currentWorkspace.id,
    });
    const client = createHeadlessWorkspacesClient(token);
    const { data, error, response } = await client.PATCH(
      "/workspaces/current",
      {
        body: body as never,
      },
    );
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const name =
    typeof body?.name === "string" ? body.name.trim() : currentWorkspace.name;
  const nameError = validateWorkspaceName(name);
  if (nameError) {
    return NextResponse.json({ error: nameError }, { status: 400 });
  }

  const urlSlug =
    typeof body?.urlSlug === "string" ? body.urlSlug : currentWorkspace.urlSlug;
  const slugError = validateWorkspaceSlug(urlSlug);
  if (slugError) {
    return NextResponse.json({ error: slugError }, { status: 400 });
  }

  if (urlSlug !== currentWorkspace.urlSlug) {
    const duplicate = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(
        and(
          eq(workspace.urlSlug, urlSlug),
          ne(workspace.id, currentWorkspace.id),
        ),
      )
      .limit(1);

    if (duplicate.length > 0) {
      return NextResponse.json(
        { error: "This URL is already taken" },
        { status: 409 },
      );
    }
  }

  const rawLogo =
    typeof body?.logo === "string" ? body.logo.trim() : body?.logo;
  if (
    typeof rawLogo === "string" &&
    rawLogo.length > 2_000_000 &&
    rawLogo.startsWith("data:image/")
  ) {
    return NextResponse.json(
      { error: "Logo image is too large" },
      { status: 400 },
    );
  }

  if (
    rawLogo !== undefined &&
    rawLogo !== null &&
    rawLogo !== "" &&
    (typeof rawLogo !== "string" || !isSupportedLogo(rawLogo))
  ) {
    return NextResponse.json(
      { error: "Unsupported logo image" },
      { status: 400 },
    );
  }

  const fiscalMonth =
    typeof body?.fiscalMonth === "string" && FISCAL_MONTHS.has(body.fiscalMonth)
      ? body.fiscalMonth
      : currentWorkspace.fiscalMonth;
  const logo =
    rawLogo === undefined
      ? currentWorkspace.logoUrl
      : typeof rawLogo === "string" && rawLogo
        ? rawLogo
        : null;
  const welcomeMessage =
    typeof body?.welcomeMessage === "string"
      ? body.welcomeMessage.trim().slice(0, 2000)
      : currentWorkspace.welcomeMessage;

  await db
    .update(workspace)
    .set({
      name,
      urlSlug,
      logoUrl: logo,
      settings: {
        ...asRecord(currentWorkspace.settings),
        region: currentWorkspace.region,
        fiscalMonth,
        welcomeMessage,
      },
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, currentWorkspace.id));

  return NextResponse.json({
    workspace: {
      id: currentWorkspace.id,
      name,
      urlSlug,
      logo,
      region: currentWorkspace.region,
      fiscalMonth,
      welcomeMessage,
      plan: currentWorkspace.plan,
    },
  });
}

export async function DELETE() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const currentWorkspace = await findCurrentWorkspace(session.user.id);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (currentWorkspace.role !== "owner" && currentWorkspace.role !== "admin") {
    return NextResponse.json(
      { error: "Only workspace admins can delete a workspace" },
      { status: 403 },
    );
  }

  if (headlessWorkspacesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: currentWorkspace.id,
    });
    const client = createHeadlessWorkspacesClient(token);
    const { data, error, response } = await client.DELETE(
      "/workspaces/current",
    );
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  await db.delete(workspace).where(eq(workspace.id, currentWorkspace.id));

  const remainingMemberships = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, session.user.id))
    .orderBy(desc(member.createdAt))
    .limit(50);

  const nextWorkspaceId = remainingMemberships[0]?.workspaceId ?? null;
  const response = NextResponse.json({
    success: true,
    redirectTo: nextWorkspaceId ? "/" : "/create-workspace",
  });

  if (nextWorkspaceId) {
    response.cookies.set("activeWorkspaceId", nextWorkspaceId, {
      path: "/",
      sameSite: "lax",
    });
  } else {
    response.cookies.delete("activeWorkspaceId");
  }

  return response;
}
