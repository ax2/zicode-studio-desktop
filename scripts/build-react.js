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
      artifacts: path.join(root, "frontend/src/features/artifacts/index.ts"),
      projects: path.join(root, "frontend/src/features/projects/index.ts"),
      help: path.join(root, "frontend/src/features/help/index.ts"),
      settings: path.join(root, "frontend/src/features/settings/index.ts"),
      notes: path.join(root, "frontend/src/features/notes/index.ts"),
      chat: path.join(root, "frontend/src/features/chat/index.ts"),
      composer: path.join(root, "frontend/src/features/composer/index.ts"),
      "session-sidebar": path.join(
        root,
        "frontend/src/features/sessionSidebar/index.ts",
      ),
      "session-search-dialog": path.join(
        root,
        "frontend/src/features/sessionSearchDialog/index.ts",
      ),
      "finance-workbench": path.join(
        root,
        "frontend/src/features/financeWorkbench/index.ts",
      ),
      "plugin-shell": path.join(
        root,
        "frontend/src/features/pluginShell/index.ts",
      ),
      "rpiv-todo-mirror": path.join(
        root,
        "frontend/src/features/rpivTodoMirror/index.ts",
      ),
      "header-open-app": path.join(
        root,
        "frontend/src/features/headerOpenApp/index.ts",
      ),
      "file-browser": path.join(
        root,
        "frontend/src/features/fileBrowser/index.ts",
      ),
      "lan-qr": path.join(
        root,
        "frontend/src/features/lanQr/index.ts",
      ),
      "mobile-experience": path.join(
        root,
        "frontend/src/features/mobileExperience/index.ts",
      ),
      dialog: path.join(
        root,
        "frontend/src/features/dialog/index.ts",
      ),
      "inline-extension-prompt": path.join(
        root,
        "frontend/src/features/inlineExtensionPrompt/index.ts",
      ),
      "plugin-manager-view": path.join(
        root,
        "frontend/src/features/pluginManagerView/index.ts",
      ),
      "startup-failure": path.join(
        root,
        "frontend/src/features/startupFailure/index.ts",
      ),
      "notification-center": path.join(
        root,
        "frontend/src/features/notificationCenter/index.ts",
      ),
      "command-palette": path.join(
        root,
        "frontend/src/features/commandPalette/index.ts",
      ),
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
