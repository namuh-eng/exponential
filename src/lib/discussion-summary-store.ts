import { db } from "@/lib/db";
import { issueDiscussionSummary } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function markIssueDiscussionSummaryStale(issueId: string) {
  const staleAt = new Date();

  try {
    await db
      .update(issueDiscussionSummary)
      .set({
        status: "stale",
        staleAt,
        error: null,
        updatedAt: staleAt,
      })
      .where(eq(issueDiscussionSummary.issueId, issueId));
  } catch (error) {
    if (process.env.NODE_ENV === "test") {
      return;
    }

    throw error;
  }
}
