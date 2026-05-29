import { requireApiSession } from "@/lib/api-auth";
import {
  checkoutUrls,
  getStripeClient,
  getStripeCustomerId,
  normalizeCheckoutPlan,
  readStripeBillingConfig,
  saveStripeCustomerId,
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

  const body = (await request.json().catch(() => null)) as {
    plan?: unknown;
  } | null;
  const plan = normalizeCheckoutPlan(body?.plan);
  if (!plan)
    return NextResponse.json(
      { error: "Unsupported self-serve billing plan" },
      { status: 400 },
    );

  try {
    const config = readStripeBillingConfig();
    const stripe = getStripeClient();
    const { successUrl, cancelUrl } = checkoutUrls(request);
    let customerId = getStripeCustomerId(currentWorkspace.settings);
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: currentWorkspace.name,
        metadata: { workspaceId: currentWorkspace.id },
      });
      customerId = customer.id;
      await saveStripeCustomerId(
        currentWorkspace.id,
        currentWorkspace.settings,
        customerId,
      );
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: currentWorkspace.id,
      line_items: [{ price: config.prices[plan], quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: { workspaceId: currentWorkspace.id, plan },
      },
      metadata: { workspaceId: currentWorkspace.id, plan },
    });
    return NextResponse.json({ url: checkout.url, sessionId: checkout.id });
  } catch (error) {
    return stripeEnvErrorResponse(error);
  }
}
