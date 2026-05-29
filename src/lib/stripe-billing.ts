import { getRequestAppUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import {
  type BillingPlanId,
  asRecord,
  normalizeBillingPlan,
} from "@/lib/workspace-billing";
import { eq } from "drizzle-orm";
import Stripe from "stripe";

export type StripeCheckoutPlan = "basic" | "business";

type StripeBillingConfig = {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  prices: Record<StripeCheckoutPlan, string>;
};

const CHECKOUT_PLANS = new Set<StripeCheckoutPlan>(["basic", "business"]);

let stripeClient: Stripe | null = null;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Stripe billing is not configured: missing ${name}`);
  }
  return value;
}

export function readStripeBillingConfig(): StripeBillingConfig {
  return {
    publishableKey: requiredEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
    secretKey: requiredEnv("STRIPE_SECRET_KEY"),
    webhookSecret: requiredEnv("STRIPE_WEBHOOK_SECRET"),
    prices: {
      basic: requiredEnv("STRIPE_CLOUD_TEAM_PRICE_ID"),
      business: requiredEnv("STRIPE_CLOUD_BUSINESS_PRICE_ID"),
    },
  };
}

export function getStripeClient() {
  const config = readStripeBillingConfig();
  if (!stripeClient) {
    stripeClient = new Stripe(config.secretKey, {
      apiVersion: "2026-05-27.dahlia",
    });
  }
  return stripeClient;
}

export function normalizeCheckoutPlan(
  value: unknown,
): StripeCheckoutPlan | null {
  return typeof value === "string" &&
    CHECKOUT_PLANS.has(value as StripeCheckoutPlan)
    ? (value as StripeCheckoutPlan)
    : null;
}

export function getStripeCustomerId(settings: unknown) {
  const billing = asRecord(asRecord(settings).billing);
  return typeof billing.stripeCustomerId === "string"
    ? billing.stripeCustomerId
    : null;
}

export async function saveStripeCustomerId(
  workspaceId: string,
  settings: unknown,
  customerId: string,
) {
  const current = asRecord(settings);
  const billing = asRecord(current.billing);
  const nextSettings = {
    ...current,
    billing: { ...billing, stripeCustomerId: customerId },
  };
  await db
    .update(workspace)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(workspace.id, workspaceId));
  return nextSettings;
}

export function stripeEnvErrorResponse(error: unknown) {
  if (
    error instanceof Error &&
    error.message.startsWith("Stripe billing is not configured")
  ) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  throw error;
}

export function checkoutUrls(request: Request) {
  const origin = getRequestAppUrl(request);
  return {
    successUrl: `${origin}/settings/billing?checkout=success`,
    cancelUrl: `${origin}/settings/billing?checkout=cancelled`,
    returnUrl: `${origin}/settings/billing`,
  };
}

export function workspaceIdFromEvent(event: Stripe.Event) {
  const object = event.data.object as {
    metadata?: Stripe.Metadata | null;
    client_reference_id?: string | null;
  };
  return object.metadata?.workspaceId ?? object.client_reference_id ?? null;
}

export function planFromPriceId(
  priceId: string | null | undefined,
  config = readStripeBillingConfig(),
): BillingPlanId | null {
  if (!priceId) return null;
  if (priceId === config.prices.basic) return "basic";
  if (priceId === config.prices.business) return "business";
  return null;
}

export async function applyStripeSubscriptionEvent(event: Stripe.Event) {
  if (
    ![
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ].includes(event.type)
  ) {
    return { applied: false };
  }

  const subscription = event.data.object as Stripe.Subscription;
  const workspaceId = subscription.metadata?.workspaceId ?? null;
  if (!workspaceId) return { applied: false };

  const [record] = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!record) return { applied: false };

  const current = asRecord(record.settings);
  const billing = asRecord(current.billing);
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id;
  const plan =
    event.type === "customer.subscription.deleted"
      ? "free"
      : (planFromPriceId(priceId) ?? normalizeBillingPlan(billing.plan));
  const nextSettings = {
    ...current,
    plan,
    billing: {
      ...billing,
      plan,
      stripeCustomerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      stripePriceId: priceId,
    },
  };

  await db
    .update(workspace)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(workspace.id, workspaceId));
  return { applied: true, plan };
}
