import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listSourceFiles(
  dir: string,
  extensions: string[],
  exclude: string[],
): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full, extensions, exclude));
    } else if (
      extensions.some((ext) => entry.endsWith(ext)) &&
      !exclude.some((part) => full.includes(part))
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("interaction guards", () => {
  it("never ships empty first-run CTA or click handlers", () => {
    const frontend = join(process.cwd(), "frontend", "src");
    const native = join(process.cwd(), "public", "native");
    const files = [
      ...listSourceFiles(frontend, [".ts", ".tsx"], [".test."]),
      ...listSourceFiles(
        native,
        [".js"],
        ["react", ".test.", "vendor"],
      ),
    ];
    const offenders = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of [
        /onCta=\{\(\) => \{\}\}/,
        /onClick=\{\(\) => \{\}\}/,
        /addEventListener\("click",\s*\(\) => \{\}\)/,
      ]) {
        if (pattern.test(text)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
