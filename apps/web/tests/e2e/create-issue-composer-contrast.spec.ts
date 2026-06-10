import { type Locator, type Page, expect, test } from "@playwright/test";
import { expandAppSidebar } from "./sidebar-helpers";

type Rgb = readonly [number, number, number];

function relativeLuminance([red, green, blue]: Rgb) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: Rgb, background: Rgb) {
  const foregroundLum = relativeLuminance(foreground);
  const backgroundLum = relativeLuminance(background);
  const light = Math.max(foregroundLum, backgroundLum);
  const dark = Math.min(foregroundLum, backgroundLum);

  return (light + 0.05) / (dark + 0.05);
}

async function renderedColors(locator: Locator) {
  return locator.evaluate((element) => {
    type BrowserRgb = readonly [number, number, number];
    type Rgba = readonly [number, number, number, number];

    function toSrgbChannel(value: number) {
      const clamped = Math.min(1, Math.max(0, value));
      const encoded =
        clamped <= 0.0031308
          ? 12.92 * clamped
          : 1.055 * clamped ** (1 / 2.4) - 0.055;

      return Math.round(encoded * 255);
    }

    function parseAlpha(value: string | undefined) {
      if (!value) {
        return 1;
      }

      return value.endsWith("%")
        ? Number(value.slice(0, -1)) / 100
        : Number(value);
    }

    function parseColor(value: string): Rgba {
      const rgbMatch = value.match(/^rgba?\((.+)\)$/);
      if (rgbMatch) {
        const parts = rgbMatch[1].replace(" / ", " ").split(/[,\s]+/);
        return [
          Number(parts[0]),
          Number(parts[1]),
          Number(parts[2]),
          parts[3] === undefined ? 1 : Number(parts[3]),
        ];
      }

      const oklabMatch = value.match(/^oklab\((.+)\)$/);
      if (oklabMatch) {
        const parts = oklabMatch[1].replace(" / ", " ").split(/\s+/);
        const lightness = parts[0].endsWith("%")
          ? Number(parts[0].slice(0, -1)) / 100
          : Number(parts[0]);
        const a = Number(parts[1]);
        const b = Number(parts[2]);
        const longL = lightness + 0.3963377774 * a + 0.2158037573 * b;
        const longM = lightness - 0.1055613458 * a - 0.0638541728 * b;
        const longS = lightness - 0.0894841775 * a - 1.291485548 * b;
        const l = longL ** 3;
        const m = longM ** 3;
        const s = longS ** 3;

        return [
          toSrgbChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
          toSrgbChannel(
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          ),
          toSrgbChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
          parseAlpha(parts[3]),
        ];
      }

      const srgbMatch = value.match(/^color\(srgb\s+(.+)\)$/);
      if (srgbMatch) {
        const parts = srgbMatch[1].replace(" / ", " ").split(/\s+/);
        return [
          Math.round(Number(parts[0]) * 255),
          Math.round(Number(parts[1]) * 255),
          Math.round(Number(parts[2]) * 255),
          parseAlpha(parts[3]),
        ];
      }

      throw new Error(`Unsupported color: ${value}`);
    }

    function blend(foreground: Rgba, background: Rgba): Rgba {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      if (alpha === 0) {
        return [0, 0, 0, 0];
      }

      return [
        Math.round(
          (foreground[0] * foreground[3] +
            background[0] * background[3] * (1 - foreground[3])) /
            alpha,
        ),
        Math.round(
          (foreground[1] * foreground[3] +
            background[1] * background[3] * (1 - foreground[3])) /
            alpha,
        ),
        Math.round(
          (foreground[2] * foreground[3] +
            background[2] * background[3] * (1 - foreground[3])) /
            alpha,
        ),
        alpha,
      ];
    }

    const backgroundLayers: Rgba[] = [];
    for (
      let current: Element | null = element;
      current;
      current = current.parentElement
    ) {
      const background = parseColor(getComputedStyle(current).backgroundColor);
      if (background[3] > 0) {
        backgroundLayers.push(background);
      }
      if (background[3] >= 1) {
        break;
      }
    }

    const background = backgroundLayers
      .reverse()
      .reduce((backdrop, layer) => blend(layer, backdrop), [255, 255, 255, 1]);
    const foreground = parseColor(getComputedStyle(element).color);

    return {
      background: [background[0], background[1], background[2]] as BrowserRgb,
      foreground: [foreground[0], foreground[1], foreground[2]] as BrowserRgb,
    };
  });
}

async function expectReadable(
  locator: Locator,
  label: string,
  minimumRatio = 4.5,
) {
  await expect
    .poll(
      async () => {
        const colors = await renderedColors(locator);
        return contrastRatio(colors.foreground, colors.background);
      },
      { message: `${label} contrast`, timeout: 1500 },
    )
    .toBeGreaterThanOrEqual(minimumRatio);
}

async function openCompactComposer(page: Page) {
  await page.goto("/foreverbrowsing/team/ENG/all");
  await expandAppSidebar(page);
  await page.getByRole("button", { name: "Create issue" }).click();

  const composer = page.getByTestId("create-issue-composer");
  await expect(composer).toBeVisible();
  await expect(composer).toHaveAttribute("data-variant", "modal");
  return composer;
}

test.describe("Create issue composer button contrast", () => {
  test("keeps submit and adjacent controls readable across states", async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("exponential-theme", "light");
      document.documentElement.classList.remove("dark");
      document.documentElement.dataset.theme = "light";
    });

    const preferencesResponse = await page.request.get(
      "/api/account/preferences",
    );
    expect(preferencesResponse.status()).toBe(200);
    const preferencesPayload = (await preferencesResponse.json()) as {
      accountPreferences: Record<string, unknown>;
    };
    const updatedPreferencesResponse = await page.request.patch(
      "/api/account/preferences",
      {
        data: {
          accountPreferences: {
            ...preferencesPayload.accountPreferences,
            theme: "light",
          },
        },
      },
    );
    expect(updatedPreferencesResponse.status()).toBe(200);

    const composer = await openCompactComposer(page);
    await page.evaluate(() => {
      window.localStorage.setItem("exponential-theme", "light");
      document.documentElement.classList.remove("dark");
      document.documentElement.dataset.theme = "light";
    });

    const submitButton = composer.getByRole("button", {
      name: "Create Issue",
    });
    await expect(submitButton).toBeDisabled();
    await expect(submitButton).toHaveAccessibleName("Create Issue");
    await expectReadable(submitButton, "disabled compact submit");

    for (const [label, control] of [
      ["status toolbar", composer.getByRole("button", { name: "Status" })],
      ["priority toolbar", composer.getByRole("button", { name: "Priority" })],
      ["attach button", composer.getByRole("button", { name: "Attach files" })],
      [
        "more-actions button",
        composer.getByRole("button", { name: "More actions" }),
      ],
      ["create-more label", composer.getByText("Create more")],
    ] as const) {
      await expectReadable(control, label);
    }

    await composer
      .getByRole("textbox", { name: "Issue title" })
      .fill(`Contrast check ${Date.now()}`);
    await expect(submitButton).toBeEnabled();
    await expectReadable(submitButton, "enabled compact submit");

    await submitButton.hover();
    await expectReadable(submitButton, "hovered compact submit");

    await submitButton.focus();
    await expectReadable(submitButton, "focused compact submit");
    await page.screenshot({
      path: testInfo.outputPath("composer-compact-light.png"),
      fullPage: true,
    });

    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      document.documentElement.dataset.theme = "dark";
    });
    await expectReadable(submitButton, "dark compact submit");
    await page.screenshot({
      path: testInfo.outputPath("composer-compact-dark.png"),
      fullPage: true,
    });

    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dataset.theme = "light";
    });

    let releaseCreate: (() => void) | undefined;
    const createRequest = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });

    await page.route("**/api/issues", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      await createRequest;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "issue-contrast-check" }),
      });
    });

    await submitButton.click();
    const loadingButton = composer.getByRole("button", { name: "Creating..." });
    await expect(loadingButton).toBeVisible();
    await expectReadable(loadingButton, "loading compact submit");
    releaseCreate?.();
    await expect(composer).toHaveCount(0);
    await page.unroute("**/api/issues");

    await page.keyboard.press("v");
    const fullscreenComposer = page.getByTestId("create-issue-composer");
    await expect(fullscreenComposer).toBeVisible();
    await expect(fullscreenComposer).toHaveAttribute(
      "data-variant",
      "fullscreen",
    );
    await fullscreenComposer
      .getByRole("textbox", { name: "Issue title" })
      .fill(`Fullscreen contrast ${Date.now()}`);
    await expectReadable(
      fullscreenComposer.getByRole("button", { name: "Create Issue" }),
      "fullscreen submit",
    );
    await page.screenshot({
      path: testInfo.outputPath("composer-fullscreen.png"),
      fullPage: true,
    });
  });
});
