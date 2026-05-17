import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  editorialPrimitiveClasses,
  editorialThemeTokens,
} from "@/lib/editorial-theme-tokens";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(process.cwd(), "src/app/editorial-theme.css"),
  "utf8",
);
const globalsCss = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

describe("Editorial theme tokens", () => {
  it("keeps a canonical typed token source aligned with global CSS variables", () => {
    expect(editorialThemeTokens.light.paper.bg).toBe("#faf7f2");
    expect(editorialThemeTokens.light.accent.default).toBe(
      "oklch(0.56 0.16 32)",
    );
    expect(editorialThemeTokens.dark.paper.bg).toBe("#15130f");
    expect(css).toContain("--editorial-bg: #faf7f2");
    expect(css).toContain("--editorial-accent: oklch(0.56 0.16 32)");
    expect(css).toContain("--editorial-sans: var(--font-inter-tight)");
    expect(css).toContain("--shadow-editorial-sm: var(--editorial-shadow-sm)");
    expect(editorialThemeTokens.shadow.md).toBe("var(--editorial-shadow-md)");
    expect(globalsCss).toContain('@import "./editorial-theme.css"');
  });

  it("documents shared primitive class names and implements them in the theme layer", () => {
    expect(editorialPrimitiveClasses).toEqual(
      expect.arrayContaining([
        "ui-button",
        "ui-chip",
        "ui-card",
        "ui-input",
        "ui-tabs",
        "ui-list-row",
        "ui-kbd",
        "ui-menu-surface",
        "ui-palette-surface",
      ]),
    );

    for (const primitiveClass of editorialPrimitiveClasses) {
      expect(css).toContain(`.${primitiveClass}`);
    }
  });

  it("routes legacy app color aliases through Editorial semantic tokens", () => {
    expect(css).toContain("--color-content-bg: var(--editorial-bg)");
    expect(css).toContain("--color-border: var(--editorial-line)");
    expect(css).toContain("--color-text-primary: var(--editorial-ink-1)");
    expect(css).toContain("--color-surface-hover: var(--editorial-hover)");
  });
});
