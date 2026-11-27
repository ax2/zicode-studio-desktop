#!/usr/bin/env node
// Incremental React migration build (esbuild).
//
// Two passes:
//   1. vendor.ts bundles React/ReactDOM once into public/native/react/vendor.js,
//      mapped by the index.html import map.
//   2. each migrated feature (frontend/src/features/<name>/index.ts) bundles to
//      public/native/react/<name>.js with React externalized to the vendor copy.
const { build } = require("esbuild");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { writeBuildOutput } = require("./write-build-output.cjs");

const featureEntries = require("./react-feature-entries.cjs");

const root = path.resolve(__dirname, "..");
const outdir = path.join(root, "public", "native", "react");
const sharedExternal = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "i18n",
  "themes",
];

async function bundle(options) {
  const { outputFiles } = await build({ ...options, write: false });
  for (const file of outputFiles) writeBuildOutput(file.path, file.contents);
}

async function run() {
  mkdirSync(outdir, { recursive: true });
  await bundle({
    entryPoints: { vendor: path.join(root, "frontend/src/vendor.ts") },
    outdir,
    bundle: true,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    logLevel: "info",
  });
  await bundle({
    entryPoints: Object.fromEntries(Object.entries(featureEntries).map(([name, entry]) =>
      [name, path.join(root, "frontend/src/features", entry)])),
    outdir,
    bundle: true,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    external: sharedExternal,
    // This trusted parent controller dynamically imports the compiled tool form.
    // Keep it as a runtime module so generated output never becomes bundle input.
    plugins: [{
      name: "shared-runtime-modules",
      setup(builder) {
        // Legacy helpers imported by React must share the shell's locale and dictionary.
        builder.onResolve({ filter: /i18n\.js$/ }, ({ path: specifier, resolveDir }) =>
          path.resolve(resolveDir, specifier) === path.join(root, "public", "i18n.js")
            ? { path: "../../i18n.js", external: true }
            : undefined,
        );
        // Read-only previews share the renderer already shipped with the app.
        builder.onResolve({ filter: /public\/ui\/markdown\.js$/ }, ({ importer }) =>
          path.basename(importer) === "ReadOnlyMarkdown.tsx"
            ? { path: "../../ui/markdown.js", external: true }
            : undefined,
        );
        builder.onResolve({ filter: /directory-resource-runner\.js$/ }, () => ({
          path: "../plugins/directory-resource-runner.js", external: true,
        }));
      },
    }],
    minify: true,
    logLevel: "info",
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
