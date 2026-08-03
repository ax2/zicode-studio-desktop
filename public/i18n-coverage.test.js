// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setLocale, t } from "./i18n.js";

function javascriptFiles(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return javascriptFiles(path);
    return path.endsWith(".js") && !path.endsWith(".test.js") ? [path] : [];
  });
}

describe("Chinese translation coverage", () => {
  it("translates every static t() key used by the native application", () => {
    setLocale("zh-CN");
    const missing = new Set();
    for (const path of javascriptFiles(join(process.cwd(), "public"))) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/\bt\(\s*(["'`])([^\n]*?)\1\s*\)/g)) {
        const key = match[2];
        if (!key.includes("${") && t(key) === key) missing.add(key);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
