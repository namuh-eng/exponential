import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import {
  createHeadlessWorkspacesClient,
  headlessWorkspacesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import {
  BILLING_PLANS,
  asRecord,
  canManageBilling,
  findBillingWorkspace,
  normalizeBillingPlan,
  readBillingState,
} from "@/lib/workspace-billing";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function billingResponse(
  currentWorkspace: NonNullable<
    Awaited<ReturnType<typeof findBillingWorkspace>>
  >,
) {
  const billing = readBillingState(currentWorkspace.settings);

  return NextResponse.json({
    workspace: {
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      urlSlug: currentWorkspace.urlSlug,
      role: currentWorkspace.role,
    },
    currentPlan: billing.plan,
    canManage: canManageBilling(currentWorkspace.role),
    usage: {
      seatsUsed: billing.seatsUsed,
      issuesUsed: billing.issuesUsed,
      issueLimit: billing.usageLimit,
    },
    plans: BILLING_PLANS,
    paymentMethods: billing.paymentMethods,
    invoices: billing.invoices,
  });
}

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  if (headlessWorkspacesEnabled()) {
    const workspaceId = await resolveRequestWorkspaceId(
      session.user.id,
      request,
    );
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.GET(
        "/workspaces/current/billing",
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const currentWorkspace = await findBillingWorkspace(session.user.id, request);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  return billingResponse(currentWorkspace);
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  if (headlessWorkspacesEnabled()) {
    const workspaceId = await resolveRequestWorkspaceId(
      session.user.id,
      request,
    );
    if (workspaceId) {
      const body = await request.json().catch(() => null);
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.PATCH(
        "/workspaces/current/billing",
        { body: body as never },
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const currentWorkspace = await findBillingWorkspace(session.user.id, request);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (!canManageBilling(currentWorkspace.role)) {
    return NextResponse.json(
      { error: "Only workspace admins can manage billing" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    plan?: unknown;
  } | null;
  const requestedPlan = normalizeBillingPlan(body?.plan);
  if (requestedPlan !== body?.plan) {
    return NextResponse.json(
      { error: "Unsupported billing plan" },
      { status: 400 },
    );
  }

  const settings = asRecord(currentWorkspace.settings);
  const existingBilling = asRecord(settings.billing);
  const nextSettings = {
    ...settings,
    plan: requestedPlan,
    billing: {
      ...existingBilling,
      plan: requestedPlan,
    },
  };

  await db
    .update(workspace)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(workspace.id, currentWorkspace.id));

  return billingResponse({ ...currentWorkspace, settings: nextSettings });
}
