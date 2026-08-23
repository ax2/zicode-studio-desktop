import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      i18n: resolve(__dirname, "public/i18n.js"),
      themes: resolve(__dirname, "public/themes.js"),
    },
  },
  test: {
    environment: "jsdom",
    // Retry timing-sensitive tests once before failing, so a transient flake
    // (e.g. right after heavy QA runs) does not fail the release gate.
    retry: 1,
    include: [
      "public/**/*.test.js",
      "frontend/src/**/*.test.{js,ts,tsx}",
      "extensions/**/*.test.ts",
      "scripts/**/*.test.js",
    ],
  },
});
