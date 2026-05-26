import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/vitest.setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    maxWorkers: 4,
  },
  resolve: {
    alias: {
      "@/lib/auth": path.resolve(__dirname, "./tests/legacy-auth.ts"),
      "test-auth": path.resolve(__dirname, "./tests/test-auth.ts"),
      "@": path.resolve(__dirname, "./src"),
      "legacy-api": path.resolve(__dirname, "./tests/legacy-api"),
    },
  },
});
