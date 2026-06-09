import { expect, test } from "@playwright/test";

type Rgb = [number, number, number];

function luminance([red, green, blue]: Rgb) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: Rgb, background: Rgb) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test.describe("Create issue composer contrast", () => {
  test("keeps the accent submit button text readable in dark theme", async ({
    page,
  }) => {
    const preferencesSettled = page
      .waitForResponse((response) =>
        response.url().includes("/api/account/preferences"),
      )
      .catch(() => null);
    await page.goto("/foreverbrowsing/team/ENG/all");
    await preferencesSettled;
    await page
      .getByRole("button", { name: /Create issue|New issue/ })
      .first()
      .click();

    const composer = page.getByTestId("create-issue-composer");
    await expect(composer).toBeVisible();
    await page.addStyleTag({
      content:
        "*,*::before,*::after{transition-duration:0s!important;animation-duration:0s!important;}",
    });

    const submitButton = composer.getByRole("button", {
      name: "Create Issue",
    });
    await expect(submitButton).toBeVisible();
    await composer.getByRole("textbox", { name: "Issue title" }).fill("Test");
    await expect(submitButton).toBeEnabled();

    await forceDarkTheme(page);
    await expectReadableContrast(submitButton);
    await submitButton.hover();
    await forceDarkTheme(page);
    await expectReadableContrast(submitButton);
  });
});

async function forceDarkTheme(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  });
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("dark"),
  );
  await page.waitForTimeout(50);
}

async function expectReadableContrast(
  locator: import("@playwright/test").Locator,
) {
  const colors = await locator.evaluate((element) => {
    function rgbFromCssColor(value: string): Rgb {
      const resolved = resolveColor(value);
      const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(resolved);
      if (rgbMatch) {
        const channels = rgbMatch[1]
          .replace(/\s*\/\s*[\d.]+%?$/, "")
          .trim()
          .split(/[\s,]+/)
          .slice(0, 3)
          .map((channel) => Number.parseFloat(channel.trim()));
        return channels as Rgb;
      }

      const oklchMatch = /^oklch\(([^)]+)\)$/.exec(resolved);
      if (oklchMatch) {
        const [lightness, chroma, hue] = oklchMatch[1]
          .split(/[\s/]+/)
          .filter(Boolean)
          .slice(0, 3);
        return oklchToSrgb(
          lightness.endsWith("%")
            ? Number.parseFloat(lightness) / 100
            : Number.parseFloat(lightness),
          Number.parseFloat(chroma),
          Number.parseFloat(hue),
        );
      }

      const oklabMatch = /^oklab\(([^)]+)\)$/.exec(resolved);
      if (oklabMatch) {
        const [lightness, a, b] = oklabMatch[1]
          .split(/[\s/]+/)
          .filter(Boolean)
          .slice(0, 3);
        return oklabToSrgb(
          lightness.endsWith("%")
            ? Number.parseFloat(lightness) / 100
            : Number.parseFloat(lightness),
          Number.parseFloat(a),
          Number.parseFloat(b),
        );
      }

      const labMatch = /^lab\(([^)]+)\)$/.exec(resolved);
      if (labMatch) {
        const [lightness, a, b] = labMatch[1]
          .split(/[\s/]+/)
          .filter(Boolean)
          .slice(0, 3);
        return labToSrgb(
          Number.parseFloat(lightness),
          Number.parseFloat(a),
          Number.parseFloat(b),
        );
      }

      throw new Error(`Unsupported color format: ${resolved}`);
    }

    function resolveColor(value: string) {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color.trim();
      probe.remove();
      return resolved;
    }

    function oklchToSrgb(lightness: number, chroma: number, hue: number): Rgb {
      const hueRadians = (hue * Math.PI) / 180;
      const a = chroma * Math.cos(hueRadians);
      const b = chroma * Math.sin(hueRadians);
      return oklabToSrgb(lightness, a, b);
    }

    function oklabToSrgb(lightness: number, a: number, b: number): Rgb {
      const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

      return [
        linearSrgbToByte(
          3.2409699419 * l - 2.5373831776 * m + 0.2069769576 * s,
        ),
        linearSrgbToByte(
          -0.9692436363 * l + 1.8759675015 * m + 0.0415550574 * s,
        ),
        linearSrgbToByte(
          0.0556300797 * l - 0.2039769589 * m + 1.0569715142 * s,
        ),
      ];
    }

    function labToSrgb(lightness: number, a: number, b: number): Rgb {
      const fy = (lightness + 16) / 116;
      const fx = fy + a / 500;
      const fz = fy - b / 200;
      const xD50 = 0.96422 * labPivot(fx);
      const yD50 = labPivot(fy);
      const zD50 = 0.82521 * labPivot(fz);
      const xD65 = 1.0479298 * xD50 - 0.0229468 * yD50 - 0.0501922 * zD50;
      const yD65 = 0.0196133 * xD50 + 0.978149 * yD50 + 0.00132045 * zD50;
      const zD65 = -0.0032582 * xD50 + 0.0051877 * yD50 + 1.06084 * zD50;

      return [
        linearSrgbToByte(3.2406 * xD65 - 1.5372 * yD65 - 0.4986 * zD65),
        linearSrgbToByte(-0.9689 * xD65 + 1.8758 * yD65 + 0.0415 * zD65),
        linearSrgbToByte(0.0557 * xD65 - 0.204 * yD65 + 1.057 * zD65),
      ];
    }

    function labPivot(value: number) {
      return value ** 3 > 0.008856 ? value ** 3 : (value - 16 / 116) / 7.787;
    }

    function linearSrgbToByte(value: number) {
      const clamped = Math.min(1, Math.max(0, value));
      const encoded =
        clamped <= 0.0031308
          ? 12.92 * clamped
          : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return encoded * 255;
    }

    const styles = getComputedStyle(element);
    return {
      background: rgbFromCssColor(styles.backgroundColor),
      foreground: rgbFromCssColor(styles.color),
      rawBackground: styles.backgroundColor,
      rawForeground: styles.color,
    };
  });

  expect(
    contrastRatio(colors.foreground, colors.background),
    `foreground ${colors.rawForeground} on background ${colors.rawBackground}`,
  ).toBeGreaterThanOrEqual(4.5);
}
