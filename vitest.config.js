import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
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
