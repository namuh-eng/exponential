/**
 * Canonical theme tokens for the TTY (terminal-native) redesign.
 *
 * The aesthetic is a vim/tmux-style terminal: warm graphite background, bone
 * off-white type, a single phosphor-green accent for live state, monospace
 * everywhere, 1px hairline borders and square corners. Dark is the primary
 * theme; light is a "paper terminal" variant.
 *
 * CSS variables are emitted in src/app/editorial-theme.css and the legacy
 * --color-* aliases intentionally resolve through these semantic tokens, so the
 * whole product reskins from this single source.
 */
export const editorialThemeTokens = {
  // Paper-terminal: cream background, deep ink, darkened phosphor accent.
  light: {
    paper: {
      bg: "#f0eee9",
      surface: "#faf9f5",
      surface2: "#e8e5dd",
      surface3: "#ddd9cf",
      hover: "rgba(20, 30, 20, 0.05)",
      pressed: "rgba(20, 30, 20, 0.09)",
    },
    ink: {
      primary: "#1a1c19",
      secondary: "#33372f",
      muted: "#5a5e52",
      faded: "#85897b",
      subtle: "#b3b6a7",
    },
    line: {
      default: "#cdcabd",
      strong: "#b3afa0",
      soft: "#e0ddd2",
    },
    accent: {
      default: "#1f7a37",
      hover: "#196530",
      soft: "#d9ecd9",
      ink: "#ffffff",
    },
  },
  // Phosphor-on-graphite: the canonical terminal look.
  dark: {
    paper: {
      bg: "#0c0d0c",
      surface: "#111312",
      surface2: "#16191a",
      surface3: "#1d2120",
      hover: "rgba(126, 231, 135, 0.06)",
      pressed: "rgba(126, 231, 135, 0.12)",
    },
    ink: {
      primary: "#d8d4c8",
      secondary: "#b8b3a6",
      muted: "#8a8579",
      faded: "#5e5b53",
      subtle: "#42403a",
    },
    line: {
      default: "#2a2e2c",
      strong: "#3a3f3c",
      soft: "#1e2120",
    },
    accent: {
      default: "#7ee787",
      hover: "#9af0a0",
      soft: "#1a2a1c",
      ink: "#0c0d0c",
    },
  },
  type: {
    display:
      "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    sans: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    mono: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  shape: {
    radius: "0px",
    radiusLg: "2px",
    radiusPill: "2px",
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
