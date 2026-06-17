import { resolveAgentContextLink } from "@/lib/agent-runs";
import { describe, expect, it } from "vitest";

describe("agent run context links", () => {
  it("resolves issue identifiers to the selected team issue route", () => {
    expect(resolveAgentContextLink("EXP-300", "ENG")).toEqual({
      href: "/team/ENG/issue/EXP-300",
    });
  });

  it("preserves external URLs for explicit external context links", () => {
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

  it("resolves project contexts to project overviews", () => {
    expect(resolveAgentContextLink("project: Platform Polish", "ENG")).toEqual({
      href: "/project/platform-polish/overview",
    });
  });
});
