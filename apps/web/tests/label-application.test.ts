import {
  normalizeApplicableIssueLabelIds,
  normalizeBulkIssueLabelIds,
} from "@/lib/label-application";
import { describe, expect, it, vi } from "vitest";

function dbReturning(rows: { id: string; parentLabelId: string | null }[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    })),
  };
}

describe("label application normalization", () => {
  it("keeps only one selected label per label group", async () => {
    const db = dbReturning([
      { id: "severity-low", parentLabelId: "severity" },
      { id: "severity-high", parentLabelId: "severity" },
      { id: "bug", parentLabelId: null },
    ]);

    const result = await normalizeApplicableIssueLabelIds({
      db,
      labelIds: ["severity-low", "bug", "severity-high"],
      workspaceId: "workspace-1",
      teamId: "team-1",
    });

    expect(result).toEqual({ ok: true, labelIds: ["bug", "severity-high"] });
  });

  it("rejects archived or inaccessible labels when query returns fewer rows", async () => {
    const db = dbReturning([{ id: "active", parentLabelId: null }]);

    const result = await normalizeBulkIssueLabelIds({
      db,
      labelIds: ["active", "archived"],
      workspaceId: "workspace-1",
      teamIds: ["team-1"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("archived");
    }
  });
});
