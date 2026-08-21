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
  it("keeps user-facing React attributes localized (no hardcoded English labels)", () => {
    const offenders = [];
    const roots = [join(process.cwd(), "frontend", "src", "features")];
    const labelPattern = /^[A-Z][a-z]+(?: [a-z]+)*$/;
    for (const path of roots.flatMap((root) => javascriptFiles(root))) {
      if (!path.endsWith(".tsx")) continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(
        /\b(placeholder|aria-label|title)="([^"]+)"/g,
      )) {
        const value = match[2];
        if (
          /^[A-Z]/.test(value) &&
          /[a-z]/.test(value) &&
          labelPattern.test(value)
        ) {
          offenders.push(`${path}: ${match[1]}="${value}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps JSX text nodes localized (no bare English labels between tags)", () => {
    const offenders = [];
    const roots = [join(process.cwd(), "frontend", "src", "features")];
    const labelPattern = /^[A-Z][a-z]+(?: [a-z]+)*$/;
    // Keyboard key names are universal and appear as hints (Esc, Ctrl+K, …).
    const keyAllowlist = new Set([
      "Esc",
      "Enter",
      "Tab",
      "Space",
      "Shift",
      "Ctrl",
      "Alt",
    ]);
    for (const path of roots.flatMap((root) => javascriptFiles(root))) {
      if (!path.endsWith(".tsx")) continue;
      const source = readFileSync(path, "utf8");
      // A bare English label is JSX text that starts after a tag close or a
      // string-expression close and ends at a closing tag. Type annotations
      // like `Promise<unknown>` never end at `</`, so they do not match.
      for (const match of source.matchAll(
        /(?:>|\})\s*\n?\s*([A-Z][a-z]+(?: [a-z]+)*)\s*\n?\s*<\//g,
      )) {
        const value = match[1];
        if (keyAllowlist.has(value)) continue;
        if (labelPattern.test(value)) {
          offenders.push(`${path}: ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

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

  it("keeps UI source free of hardcoded Chinese outside the bilingual allowlist", () => {
    // Files that legitimately contain Han characters: the zh-CN dictionary,
    // bilingual pairs (offline/service-worker/themes), internal model-error
    // matching regexes, help icon keywords, the Help center's isEn branches,
    // code comments, and the Chinese model prompt templates (app.js and the
    // automation template library).
    // Anything else is a hardcoded Chinese UI string that breaks the English
    // interface (e.g. the emoji categories or the Agent Inbox panel).
    const allowed = new Set([
      join(process.cwd(), "public", "i18n.js"),
      join(process.cwd(), "public", "offline.js"),
      join(process.cwd(), "public", "service-worker.js"),
      join(process.cwd(), "public", "themes.js"),
      join(process.cwd(), "public", "native", "features", "remote-auth.js"),
      join(process.cwd(), "public", "native", "transport", "e2ee.js"),
      join(process.cwd(), "public", "native", "app.js"),
      join(process.cwd(), "frontend", "src", "features", "automation", "templates.ts"),
      join(process.cwd(), "frontend", "src", "features", "chat", "chatLogic.ts"),
      join(process.cwd(), "frontend", "src", "features", "help", "logic.ts"),
      join(process.cwd(), "frontend", "src", "features", "help", "HelpCenterApp.tsx"),
    ]);
    const offenders = [];
    const roots = [
      join(process.cwd(), "public"),
      join(process.cwd(), "frontend", "src"),
    ];
    for (const path of roots.flatMap((root) => javascriptFiles(root))) {
      if (allowed.has(path)) continue;
      const source = readFileSync(path, "utf8");
      if (/[\p{Script=Han}]/u.test(source)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
