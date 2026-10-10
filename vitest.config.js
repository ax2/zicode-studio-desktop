import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

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
    // Bound concurrent jsdom instances and module transforms on developer machines/CI.
    maxWorkers: 4,
    // Node 25+ exposes its own Storage globals; jsdom must own them in test workers.
    poolOptions: {
      forks: {
        execArgv:
          Number(process.versions.node.split(".")[0]) >= 25 ? ["--no-experimental-webstorage"] : [],
      },
    },
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
