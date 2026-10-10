// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
describe.each(["", "en"])("bundled help %s", (locale) => {
  const directory = join(root, locale);
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  it("registers unique pages backed by readable bundled Markdown", () => {
    const ids = manifest.pages.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const page of manifest.pages) {
      expect(page.file).toMatch(/^[\w-]+\.md$/);
      const content = readFileSync(join(directory, page.file), "utf8");
      expect(content.trim()).toMatch(/^# /);
      expect(manifest.sections).toContain(page.section);
    }
  });
  it("keeps bundled Markdown links within the registered help pages", () => {
    const files = new Set(manifest.pages.map((page) => page.file));
    for (const page of manifest.pages) {
      const content = readFileSync(join(directory, page.file), "utf8");
      for (const match of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(match[1])) continue;
        expect(files.has(match[1]), `${page.file} links to ${match[1]}`).toBe(true);
        expect(existsSync(resolve(directory, match[1]))).toBe(true);
      }
    }
  });
});

it("provides the same help page IDs in both bundled languages", () => {
  const ids = (locale) => JSON.parse(readFileSync(join(root, locale, "manifest.json"), "utf8"))
    .pages.map((page) => page.id).sort();
  expect(ids("en")).toEqual(ids(""));
});
