import { describe, expect, it } from "vitest";
import { parseIssueBody, readFlag, readOption, requireOption } from "./args.js";

describe("cli args", () => {
  it("reads options and flags", () => {
    const args = ["--title", "Fix bug", "--watch"];
    expect(readOption(args, "title")).toBe("Fix bug");
    expect(readFlag(args, "watch")).toBe(true);
    expect(() => requireOption(args, "team-id")).toThrow(
      "--team-id is required",
    );
  });

  it("parses issue body", () => {
    expect(
      parseIssueBody([
        "--title",
        "Fix bug",
        "--team-id",
        "team-1",
        "--estimate",
        "3",
      ]),
    ).toMatchObject({
      title: "Fix bug",
      team_id: "team-1",
      estimate: 3,
      priority: "none",
    });
  });
});
