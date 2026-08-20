// Static binding contract for the shared settings bundle.
//
// `public/native/app.js` and the workspace actions import named exports from
// the built `public/native/react/settings.js`. A missing named export or a
// forgotten import surfaces only at runtime as a `ReferenceError` on the
// dispatch path (e.g. `getSelectedSceneId is not defined` when a task is
// approved), so pin the bindings here instead.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative) => readFileSync(join(process.cwd(), relative), "utf8");

function namedImports(source, fromModule) {
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${fromModule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
    "g",
  );
  const names = [];
  for (const match of source.matchAll(pattern)) {
    for (const part of match[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      names.push(trimmed.split(/\s+as\s+/).pop());
    }
  }
  return names;
}

describe("settings bundle import contract", () => {
  const app = read("public/native/app.js");
  const workspaceActions = read("public/native/workspace/workspace-actions.js");
  const bundle = read("public/native/react/settings.js");
  const consumers = [
    ["public/native/app.js", app, "./react/settings.js"],
    ["public/native/workspace/workspace-actions.js", workspaceActions, "../react/settings.js"],
  ];

  for (const [file, source, fromModule] of consumers) {
    it(`${file} binds every identifier it imports from the settings bundle`, () => {
      const names = namedImports(source, fromModule);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(
          bundle,
          `${file} imports ${name} but the built settings.js does not export it`,
        ).toMatch(new RegExp(`\\b${name}\\b`));
      }
    });
  }

  it("imports getSelectedSceneId wherever it is called", () => {
    const appUses = (app.match(/\bgetSelectedSceneId\b/g) ?? []).length;
    if (appUses > 0) {
      expect(app).toMatch(
        /import\s*\{[^}]*\bgetSelectedSceneId\b[^}]*\}\s*from\s*"\.\/react\/settings\.js"/,
      );
    }
    const actionUses = (workspaceActions.match(/\bgetSelectedSceneId\b/g) ?? []).length;
    if (actionUses > 0) {
      expect(workspaceActions).toMatch(
        /import\s*\{[^}]*\bgetSelectedSceneId\b[^}]*\}\s*from\s*"\.\.\/react\/settings\.js"/,
      );
    }
    expect(bundle).toMatch(/\bgetSelectedSceneId\b/);
  });
});
