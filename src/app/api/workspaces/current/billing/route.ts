import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import {
  BILLING_PLANS,
  asRecord,
  canManageBilling,
  findBillingWorkspace,
  getWorkspaceEntitlements,
  isSupportedBillingPlanInput,
  normalizeBillingPlan,
  readBillingState,
} from "@/lib/workspace-billing";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function billingResponse(
  currentWorkspace: NonNullable<
    Awaited<ReturnType<typeof findBillingWorkspace>>
  >,
) {
  const billing = readBillingState(currentWorkspace.settings);
  const entitlements = await getWorkspaceEntitlements({
    workspaceId: currentWorkspace.id,
    settings: currentWorkspace.settings,
  });

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
      seatsUsed: entitlements.activeSeats,
      seatLimit: entitlements.memberLimit,
      issuesUsed: billing.issuesUsed,
      issueLimit: billing.usageLimit,
    },
    entitlements,
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
  if (!isSupportedBillingPlanInput(body?.plan)) {
    return NextResponse.json(
      { error: "Unsupported billing plan" },
      { status: 400 },
    );
  }

  const requestedPlan = normalizeBillingPlan(body?.plan);
  const requestedPlanDetails = BILLING_PLANS.find(
    (plan) => plan.id === requestedPlan,
  );
  if (requestedPlanDetails?.priceLabel === "Custom") {
    return NextResponse.json(
      {
        error:
          "Enterprise Cloud and Enterprise Self-hosted plans require contacting sales.",
      },
      { status: 409 },
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
