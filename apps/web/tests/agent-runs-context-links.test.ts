import {
  createAgentRun,
  listAgentRuns,
  resolveAgentContextLink,
} from "@/lib/agent-runs";
import { describe, expect, it } from "vitest";

describe("agent run context links", () => {
  it("resolves issue identifiers to the selected team issue route", () => {
    expect(resolveAgentContextLink("EXP-300", "ENG")).toEqual({
      href: "/team/ENG/issue/EXP-300",
    });
  });

  it("preserves absolute external URL contexts", () => {
    expect(
      resolveAgentContextLink(
        "https://github.com/namuh-eng/whetline/pull/372",
        "ENG",
      ),
    ).toEqual({
      href: "https://github.com/namuh-eng/whetline/pull/372",
      isExternal: true,
    });
  });

  it("falls back to workspace search for unknown contexts", () => {
    expect(resolveAgentContextLink("needs product follow-up", "ENG")).toEqual({
      href: "/search?q=needs%20product%20follow-up",
    });
  });

  it("gives seeded suggestions their own issue links instead of assigned issues", () => {
    const [seededRun] = listAgentRuns("agent-context-seeded-workspace");

    expect(
      seededRun.suggestions.map((suggestion) => suggestion.contextUrl),
    ).toEqual(["/team/EXP/issue/EXP-300", "/team/EXP/issue/EXP-297"]);
    expect(
      seededRun.suggestions.some(
        (suggestion) => suggestion.contextUrl === "/my-issues/assigned",
      ),
    ).toBe(false);
  });

  it("stores the created run suggestion link from the user-entered target context", () => {
    const run = createAgentRun("agent-context-created-workspace", {
      title: "Investigate agent link",
      prompt: "Inspect the linked issue and propose a focused fix.",
      teamKey: "ENG",
      context: "EXP-300",
    });

    expect(run.suggestions[0]).toMatchObject({
      target: "EXP-300",
      contextUrl: "/team/ENG/issue/EXP-300",
    });
  });
});
