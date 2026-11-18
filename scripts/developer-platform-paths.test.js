// @vitest-environment node
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const platform = read("../.github/workflows/developer-platform.yml");

function event(name) {
  const block = platform.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w]+:|^permissions:)`, "m"),
  );
  expect(block, `missing ${name} trigger`).not.toBeNull();
  return block[1];
}

function ignoredPaths(name) {
  const paths = event(name).match(/    paths-ignore:\n((?:      - "[^"\n]+"\n)+)/);
  expect(paths, `missing ${name} paths-ignore`).not.toBeNull();
  return [...paths[1].matchAll(/- "([^"]+)"/g)].map((match) => match[1]);
}

const documentation = [
  "AGENTS.md",
  "CONTEXT.md",
  "README.md",
  "docs/requirements.md",
  "docs/agents/project-management.md",
  "docs/adr/0001-plugin-host.md",
  "docs/iterations/2026-11-18-ci.md",
  "docs/releases/v0.6.5.md",
  "docs/reviews/windows-ci.md",
];
const platformInputs = [
  "src-tauri/src/main.rs",
  "frontend/src/features/notes/NotesApp.tsx",
  "AGENTS.json",
  "docs/agents/policy.json",
  "docs/agents/fixtures/example.md",
  "docs/iterations/fixtures/request.md",
  "docs/plugins/devtools-all-tools-matrix.md",
  "docs/plugins/devtools-all-tools-matrix.json",
  "docs/plugins/catalog-snapshots/dev.105/tools.json",
  "tests/fixtures/tool/README.md",
  "scripts/project-status.mjs",
  "scripts/developer-platform-checks.mjs",
  "src-tauri/tauri.conf.json",
  "src-tauri/windows/installer-safe.nsi",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "bun.lock",
  "mkdocs.yml",
  "requirements-docs.txt",
  ".github/workflows/developer-platform.yml",
  ".github/workflows/release.yml",
  ".github/workflows/docs.yml",
  ".github/workflows/tests.yml",
];

describe("developer platform documentation filters", () => {
  for (const name of ["pull_request", "push"]) {
    it(`skips only reviewed explanation paths for ${name}`, () => {
      const patterns = ignoredPaths(name);
      const ignored = (file) => patterns.some((pattern) => posix.matchesGlob(file, pattern));
      for (const file of documentation) expect(ignored(file), file).toBe(true);
      for (const file of platformInputs) expect(ignored(file), file).toBe(false);
      // GitHub skips paths-ignore only when every changed file matches.
      expect(documentation.every(ignored)).toBe(true);
      for (const file of platformInputs) {
        expect([...documentation, file].every(ignored), `mixed change with ${file}`).toBe(false);
      }
    });
  }

  it("uses identical path boundaries for PR and main changes", () => {
    expect(ignoredPaths("pull_request")).toEqual(ignoredPaths("push"));
    expect(event("push")).toContain("branches: [main]");
  });

  it("retains manual Windows, documentation, unit, and formal release checks", () => {
    expect(event("workflow_dispatch")).toContain("default: windows");
    expect(event("workflow_dispatch")).not.toContain("paths-ignore");
    expect(read("../.github/workflows/tests.yml")).not.toContain("paths-ignore");
    expect(read("../.github/workflows/docs.yml")).toContain('- "docs/**"');
    expect(read("../.github/workflows/release.yml")).not.toContain("paths-ignore");
  });
});
