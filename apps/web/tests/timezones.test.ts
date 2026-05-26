import { buildTimezoneOptions } from "@/lib/timezones";
import { describe, expect, it } from "vitest";

describe("buildTimezoneOptions", () => {
  it("builds a broad timezone catalog instead of a short hardcoded list", () => {
    const options = buildTimezoneOptions(new Date("2026-01-15T12:00:00Z"));

    expect(options.length).toBeGreaterThan(100);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "Asia/Seoul",
          label: expect.stringContaining("GMT+09:00"),
        }),
        expect.objectContaining({
          value: "Europe/Madrid",
          label: expect.stringContaining("Madrid"),
        }),
        expect.objectContaining({
          value: "America/New_York",
          label: expect.stringContaining("GMT-05:00"),
        }),
      ]),
    );
  });
});
