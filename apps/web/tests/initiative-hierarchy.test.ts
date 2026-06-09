import {
  getDescendantInitiativeIds,
  validateInitiativeParentLink,
} from "@/lib/initiative-hierarchy";
import { describe, expect, it } from "vitest";

const hierarchy = [
  { id: "a", name: "A", parentInitiativeId: null },
  { id: "b", name: "B", parentInitiativeId: "a" },
  { id: "c", name: "C", parentInitiativeId: "b" },
  { id: "d", name: "D", parentInitiativeId: null },
];

describe("initiative hierarchy validation", () => {
  it("rejects direct self-parenting", () => {
    expect(validateInitiativeParentLink(hierarchy, "a", "a")).toEqual({
      ok: false,
      error: "Cannot create a circular initiative hierarchy",
    });
  });

  it("rejects a two-node cycle", () => {
    expect(validateInitiativeParentLink(hierarchy, "a", "b")).toEqual({
      ok: false,
      error: "Cannot create a circular initiative hierarchy",
    });
  });

  it("rejects a deeper ancestor cycle", () => {
    expect(validateInitiativeParentLink(hierarchy, "a", "c")).toEqual({
      ok: false,
      error: "Cannot create a circular initiative hierarchy",
    });
  });

  it("allows valid reparenting and unlinking", () => {
    expect(validateInitiativeParentLink(hierarchy, "c", "d")).toEqual({
      ok: true,
    });
    expect(validateInitiativeParentLink(hierarchy, "c", null)).toEqual({
      ok: true,
    });
  });

  it("finds nested descendants for parent pickers", () => {
    expect(getDescendantInitiativeIds(hierarchy, "a")).toEqual(
      new Set(["b", "c"]),
    );
  });
});
