import {
  GLOBAL_SHORTCUT_ACTIONS,
  KEYBOARD_SHORTCUTS,
  getShortcutByAction,
} from "@/lib/keyboard-shortcuts";
import { describe, expect, it } from "vitest";

describe("keyboard shortcut registry", () => {
  it("documents every globally actionable shortcut from the shared registry", () => {
    for (const action of GLOBAL_SHORTCUT_ACTIONS) {
      const shortcut = getShortcutByAction(action);
      expect(shortcut, `${action} shortcut`).toBeDefined();
      expect(shortcut?.scope).toBe("global");
      expect(shortcut?.keys.length).toBeGreaterThan(0);
    }
  });

  it("does not include placeholder shortcuts without actions or keys", () => {
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      expect(shortcut.action).toBeTruthy();
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.keys.every((key) => key.trim().length > 0)).toBe(true);
    }
  });
});
