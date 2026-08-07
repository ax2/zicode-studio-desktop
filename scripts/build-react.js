#!/usr/bin/env node
// Incremental React migration build (esbuild).
//
// Two passes:
//   1. vendor.ts bundles React/ReactDOM once into public/native/react/vendor.js,
//      mapped by the index.html import map.
//   2. each migrated feature (frontend/src/features/<name>/index.ts) bundles to
//      public/native/react/<name>.js with React externalized to the vendor copy.
const { build } = require("esbuild");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outdir = path.join(root, "public", "native", "react");
const reactExternal = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];

async function run() {
  await build({
    entryPoints: { vendor: path.join(root, "frontend/src/vendor.ts") },
    outdir,
    bundle: true,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    logLevel: "info",
  });
  await build({
    entryPoints: {
      automation: path.join(root, "frontend/src/features/automation/index.ts"),
      tasks: path.join(root, "frontend/src/features/tasks/index.ts"),
    },
    outdir,
    bundle: true,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    external: reactExternal,
    minify: true,
    logLevel: "info",
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
