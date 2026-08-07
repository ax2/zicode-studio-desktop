// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setLocale, t } from "./i18n.js";

function javascriptFiles(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      // Built React bundles are minified; source files carry the real keys.
      const segments = path.split(/[\\/]/);
      if (segments.at(-2) === "native" && segments.at(-1) === "react") return [];
      return javascriptFiles(path);
    }
    const isSource =
      path.endsWith(".js") || path.endsWith(".ts") || path.endsWith(".tsx");
    return isSource && !/(\.test\.|\.d\.)/.test(path) ? [path] : [];
  });
}

describe("Chinese translation coverage", () => {
  it("translates every static t() key used by the native application", () => {
    setLocale("zh-CN");
    const missing = new Set();
    const roots = [
      join(process.cwd(), "public"),
      join(process.cwd(), "frontend", "src"),
    ];
    for (const path of roots.flatMap((root) => javascriptFiles(root))) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/\bt\(\s*(["'`])([^\n]*?)\1\s*\)/g)) {
        const key = match[2];
        if (!key.includes("${") && t(key) === key) missing.add(key);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
