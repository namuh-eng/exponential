import {
  applyStripeSubscriptionEvent,
  getStripeClient,
  readStripeBillingConfig,
  stripeEnvErrorResponse,
} from "@/lib/stripe-billing";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature)
    return NextResponse.json(
      { error: "Missing Stripe signature" },
      { status: 400 },
    );
  const payload = await request.text();
  try {
    const event = getStripeClient().webhooks.constructEvent(
      payload,
      signature,
      readStripeBillingConfig().webhookSecret,
    );
    await applyStripeSubscriptionEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    if (
      error instanceof Error &&
      !error.message.startsWith("Stripe billing is not configured")
    ) {
      return NextResponse.json(
        { error: "Invalid Stripe signature" },
        { status: 400 },
      );
    }
    return stripeEnvErrorResponse(error);
  }
}
