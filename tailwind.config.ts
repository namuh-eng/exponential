import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--editorial-sans)",
          "var(--font-inter-tight)",
          "system-ui",
          "sans-serif",
        ],
        display: ["var(--editorial-display)", "Georgia", "serif"],
        mono: ["var(--editorial-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
