import { requireApiSession } from "@/lib/api-auth";
import {
  checkoutUrls,
  getStripeClient,
  getStripeCustomerId,
  stripeEnvErrorResponse,
} from "@/lib/stripe-billing";
import {
  canManageBilling,
  findBillingWorkspace,
} from "@/lib/workspace-billing";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const currentWorkspace = await findBillingWorkspace(session.user.id, request);
  if (!currentWorkspace)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  if (!canManageBilling(currentWorkspace.role))
    return NextResponse.json(
      { error: "Only workspace admins can manage billing" },
      { status: 403 },
    );
  const customerId = getStripeCustomerId(currentWorkspace.settings);
  if (!customerId)
    return NextResponse.json(
      { error: "No Stripe customer is linked to this workspace" },
      { status: 409 },
    );
  try {
    const portal = await getStripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: checkoutUrls(request).returnUrl,
    });
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    return stripeEnvErrorResponse(error);
  }
}
