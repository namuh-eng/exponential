import { db } from "@/lib/db";
import { account } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export type IntegrationProviderId = "github" | "gitlab" | "slack";

export type IntegrationActor = {
  provider: IntegrationProviderId;
  externalAccountId: string;
};

export async function resolveIntegrationActorUserId({
  provider,
  externalAccountId,
}: IntegrationActor) {
  const normalizedExternalAccountId = externalAccountId.trim();
  if (!normalizedExternalAccountId) {
    return null;
  }

  const [connectedAccount] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(
      and(
        eq(account.providerId, provider),
        eq(account.accountId, normalizedExternalAccountId),
      ),
    )
    .limit(1);

  return connectedAccount?.userId ?? null;
}
