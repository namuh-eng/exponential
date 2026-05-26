import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cli command surface", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  it("advertises PAT login and the required issue lifecycle commands", () => {
    expect(source).toContain("exponential login --token pat_<token>");
    expect(source).toContain("exponential issues list");
    expect(source).toContain("exponential issues create");
    expect(source).toContain("exponential issues update");
    expect(source).toContain("exponential issues delete");
    expect(source).toContain("exponential issues watch");
  });
});
