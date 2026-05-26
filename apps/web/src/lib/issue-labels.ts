import { db } from "@/lib/db";
import { issueLabel, label } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function getLabelsForIssues(
  issueIds: string[],
): Promise<Record<string, { id: string; name: string; color: string }[]>> {
  if (issueIds.length === 0) return {};

  const rows = await db
    .select({
      issueId: issueLabel.issueId,
      labelId: label.id,
      labelName: label.name,
      labelColor: label.color,
    })
    .from(issueLabel)
    .innerJoin(label, eq(issueLabel.labelId, label.id))
    .where(inArray(issueLabel.issueId, issueIds));

  const map: Record<string, { id: string; name: string; color: string }[]> = {};
  for (const row of rows) {
    if (!map[row.issueId]) map[row.issueId] = [];
    map[row.issueId].push({
      id: row.labelId,
      name: row.labelName,
      color: row.labelColor,
    });
  }
  return map;
}
