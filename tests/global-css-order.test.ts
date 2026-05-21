import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = path.join(process.cwd(), "src", "app");

function cssStatementsBeforeTailwindBase(css: string) {
  const beforeBase = css.split("@tailwind base;")[0] ?? "";
  return Array.from(beforeBase.matchAll(/@import\s+["']([^"']+)["'];/g)).map(
    (match) => match[1],
  );
}

describe("global CSS Tailwind ordering", () => {
  it("does not import Tailwind layer CSS before @tailwind base", () => {
    const globalsCss = readFileSync(path.join(appDir, "globals.css"), "utf8");
    const importsBeforeBase = cssStatementsBeforeTailwindBase(globalsCss);

    for (const importPath of importsBeforeBase) {
      const importedCss = readFileSync(path.join(appDir, importPath), "utf8");
      expect(
        importedCss,
        `${importPath} must not define @layer before globals.css declares @tailwind base`,
      ).not.toMatch(/@layer\s+(base|components|utilities)\b/);
    }
  });
});
