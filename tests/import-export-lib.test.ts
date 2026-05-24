import {
  buildCsvPreview,
  inferCsvMapping,
  normalizePriority,
  parseCsv,
} from "@/lib/import-export";
import { describe, expect, it } from "vitest";

describe("import/export helpers", () => {
  it("parses quoted CSV values and infers common issue columns", () => {
    const parsed = parseCsv(
      'title,description,priority,team\n"Ship, fast","Line one",high,ENG',
    );

    expect(parsed.headers).toEqual([
      "title",
      "description",
      "priority",
      "team",
    ]);
    expect(parsed.rows[0]).toMatchObject({
      title: "Ship, fast",
      description: "Line one",
      priority: "high",
      team: "ENG",
    });
    expect(inferCsvMapping(parsed.headers)).toEqual({
      title: "title",
      description: "description",
      priority: "priority",
      teamKey: "team",
    });
  });

  it("returns row-level validation errors without accepting bad priorities", () => {
    const preview = buildCsvPreview("title,priority\n,critical\nValid,medium", {
      title: "title",
      priority: "priority",
    });

    expect(preview.rowCount).toBe(2);
    expect(preview.validCount).toBe(1);
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0].errors).toEqual([
      "Title is required",
      "Priority must be none, urgent, high, medium, or low",
    ]);
    expect(normalizePriority("urgent")).toBe("urgent");
    expect(normalizePriority("critical")).toBe("none");
  });
});
