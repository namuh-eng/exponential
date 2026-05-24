import { randomBytes } from "node:crypto";
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
  normalizeSlaPolicyInput,
  readSlaSettings,
  serializeSlaSettings,
} from "@/lib/sla-policies";
import { canPerformWorkspacePermission } from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type Access = {
  workspaceId: string;
  settings: unknown;
  memberRole: "owner" | "admin" | "member" | "guest";
};

function createId() {
  return `sla_${randomBytes(8).toString("hex")}`;
}

async function loadAccess(): Promise<
  { error: Response; access: null } | { error: null; access: Access }
> {
  const { response, session } = await requireApiSession();
  if (response || !session) {
    return {
      error:
        response ??
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      access: null,
    };
  }

  const workspaceId =
    "apiKey" in session
      ? session.apiKey.workspaceId
      : await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return {
      error: NextResponse.json({ error: "No workspace" }, { status: 404 }),
      access: null,
    };
  }

  const [access] = await db
    .select({
      workspaceId: workspace.id,
      settings: workspace.settings,
      memberRole: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.workspaceId, workspaceId),
        eq(member.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!access) {
    return {
      error: NextResponse.json({ error: "No workspace" }, { status: 404 }),
      access: null,
    };
  }

  return { error: null, access };
}

function canManage(role: Access["memberRole"]) {
  return canPerformWorkspacePermission(role, "admins");
}

export async function GET() {
  const { response, session } = await requireApiSession();
  if (response || !session) {
    return (
      response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  if (headlessWorkspacesEnabled()) {
    const workspaceId =
      "apiKey" in session
        ? session.apiKey.workspaceId
        : await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.GET(
        "/workspaces/current/sla",
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const { error, access } = await loadAccess();
  if (error || !access) return error;

  return NextResponse.json({
    sla: {
      ...readSlaSettings(access.settings),
      canManage: canManage(access.memberRole),
    },
  });
}

export async function POST(request: Request) {
  const { response, session } = await requireApiSession();
  if (response || !session) {
    return (
      response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  if (headlessWorkspacesEnabled()) {
    const workspaceId =
      "apiKey" in session
        ? session.apiKey.workspaceId
        : await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const body = await request.json().catch(() => null);
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.POST(
        "/workspaces/current/sla",
        {
          body: body as never,
        },
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const { error, access } = await loadAccess();
  if (error || !access) return error;
  if (!canManage(access.memberRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) ?? {};
  const normalized = normalizeSlaPolicyInput(body);
  if ("error" in normalized) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const current = readSlaSettings(access.settings);
  const now = new Date().toISOString();
  const policy = {
    id: createId(),
    ...normalized.value,
    createdAt: now,
    updatedAt: now,
  };
  const settings = serializeSlaSettings(access.settings, {
    policies: [policy, ...current.policies],
  });

  await db
    .update(workspace)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspace.id, access.workspaceId));

  return NextResponse.json({ policy }, { status: 201 });
}
