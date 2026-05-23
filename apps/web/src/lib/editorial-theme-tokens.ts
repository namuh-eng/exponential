/**
 * Canonical Editorial theme tokens ported from the OpenGitHub prototype.
 * CSS variables are emitted in src/app/editorial-theme.css and legacy
 * --color-* aliases intentionally resolve through these semantic tokens.
 */
export const editorialThemeTokens = {
  light: {
    paper: {
      bg: "#faf7f2",
      surface: "#ffffff",
      surface2: "#f3eee5",
      surface3: "#ebe5d9",
      hover: "rgba(20, 18, 14, 0.04)",
      pressed: "rgba(20, 18, 14, 0.08)",
    },
    ink: {
      primary: "#14120e",
      secondary: "#2d2a23",
      muted: "#5b564a",
      faded: "#8a8478",
      subtle: "#b6b0a3",
    },
    line: {
      default: "#e2dccd",
      strong: "#cdc5b3",
      soft: "#ede7d8",
    },
    accent: {
      default: "oklch(0.56 0.16 32)",
      hover: "oklch(0.5 0.17 32)",
      soft: "oklch(0.92 0.06 35)",
      ink: "#ffffff",
    },
  },
  dark: {
    paper: {
      bg: "#15130f",
      surface: "#1c1a16",
      surface2: "#232019",
      surface3: "#2c2820",
      hover: "rgba(255, 250, 240, 0.04)",
      pressed: "rgba(255, 250, 240, 0.08)",
    },
    ink: {
      primary: "#f3ede0",
      secondary: "#ddd6c5",
      muted: "#9c9583",
      faded: "#6e6857",
      subtle: "#443f33",
    },
    line: {
      default: "#2e2a22",
      strong: "#423d31",
      soft: "#25221b",
    },
    accent: {
      default: "oklch(0.68 0.15 32)",
      hover: "oklch(0.74 0.16 32)",
      soft: "oklch(0.3 0.08 32)",
      ink: "#ffffff",
    },
  },
  type: {
    display: "var(--font-fraunces), Georgia, serif",
    sans: "var(--font-inter-tight), var(--font-inter), system-ui, sans-serif",
    mono: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  shape: {
    radius: "6px",
    radiusLg: "10px",
    radiusPill: "999px",
  },
  shadow: {
    sm: "var(--editorial-shadow-sm)",
    md: "var(--editorial-shadow-md)",
    lg: "var(--editorial-shadow-lg)",
  },
} as const;

export const editorialPrimitiveClasses = [
  "ui-button",
  "ui-chip",
  "ui-card",
  "ui-input",
  "ui-tabs",
  "ui-list-row",
  "ui-kbd",
  "ui-menu-surface",
  "ui-palette-surface",
] as const;
