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
    include: [
      "public/**/*.test.js",
      "frontend/src/**/*.test.{js,ts,tsx}",
      "extensions/**/*.test.ts",
      "scripts/**/*.test.js",
    ],
  },
});
