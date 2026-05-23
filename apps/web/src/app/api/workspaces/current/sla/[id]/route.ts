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

type Params = { params: Promise<{ id: string }> | { id: string } };

type Access = {
  workspaceId: string;
  settings: unknown;
  memberRole: "owner" | "admin" | "member" | "guest";
};

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

async function policyId({ params }: Params) {
  return (await params).id;
}

export async function PATCH(request: Request, context: Params) {
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
      const id = await policyId(context);
      const body = await request.json().catch(() => null);
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.PATCH(
        "/workspaces/current/sla/{id}",
        {
          params: { path: { id } },
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
  const id = await policyId(context);
  const current = readSlaSettings(access.settings);
  const existing = current.policies.find((policy) => policy.id === id);
  if (!existing) {
    return NextResponse.json(
      { error: "SLA policy not found" },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => null)) ?? {};
  const normalized = normalizeSlaPolicyInput({ ...existing, ...body });
  if ("error" in normalized) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }
  const updated = {
    ...existing,
    ...normalized.value,
    updatedAt: new Date().toISOString(),
  };
  const settings = serializeSlaSettings(access.settings, {
    policies: current.policies.map((policy) =>
      policy.id === id ? updated : policy,
    ),
  });
  await db
    .update(workspace)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspace.id, access.workspaceId));
  return NextResponse.json({ policy: updated });
}

export async function DELETE(_request: Request, context: Params) {
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
      const id = await policyId(context);
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.DELETE(
        "/workspaces/current/sla/{id}",
        {
          params: { path: { id } },
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
  const id = await policyId(context);
  const current = readSlaSettings(access.settings);
  if (!current.policies.some((policy) => policy.id === id)) {
    return NextResponse.json(
      { error: "SLA policy not found" },
      { status: 404 },
    );
  }
  const settings = serializeSlaSettings(access.settings, {
    policies: current.policies.filter((policy) => policy.id !== id),
  });
  await db
    .update(workspace)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspace.id, access.workspaceId));
  return NextResponse.json({ ok: true });
}
