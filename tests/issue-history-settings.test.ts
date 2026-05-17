import {
  readDetailedHistoryEnabled,
  shouldRecordIssueHistoryEvent,
} from "@/lib/issue-history";
import { describe, expect, it } from "vitest";

describe("issue history settings", () => {
  it("records essential events even when detailed history is disabled", () => {
    expect(
      shouldRecordIssueHistoryEvent("created", { detailedHistory: false }),
    ).toBe(true);
    expect(
      shouldRecordIssueHistoryEvent("comment_created", {
        detailedHistory: false,
      }),
    ).toBe(true);
  });

  it("suppresses audit update events only when detailed history is disabled", () => {
    expect(readDetailedHistoryEnabled({ detailedHistory: false })).toBe(false);
    expect(
      shouldRecordIssueHistoryEvent("updated", { detailedHistory: false }),
    ).toBe(false);
    expect(shouldRecordIssueHistoryEvent("updated", {})).toBe(true);
    expect(
      shouldRecordIssueHistoryEvent("updated", { detailedHistory: true }),
    ).toBe(true);
  });
});
