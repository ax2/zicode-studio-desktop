// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function triggers(name) {
  const yaml = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
  const block = yaml.split(/^on:[ \t]*\r?\n/m)[1]?.split(/^\S/m)[0] ?? "";
  return { block, events: [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((entry) => entry[1]) };
}

describe("GitHub build triggers", () => {
  for (const name of ["tests", "developer-platform", "docs"]) {
    it(`runs ${name} only when manually dispatched`, () => {
      expect(triggers(name).events).toEqual(["workflow_dispatch"]);
    });
  }

  it("defaults manual platform checks to Windows", () => {
    expect(triggers("developer-platform").block).toMatch(/^\s+default: windows\r?$/m);
  });

  it("preserves release tags and an explicit manual entry point", () => {
    const { block, events } = triggers("release");
    expect(events).toEqual(["push", "workflow_dispatch"]);
    expect(block).toMatch(/^ {2}push:\r?\n {4}tags:\r?\n {6}- "v\*"\r?$/m);
    expect(block).toMatch(/^\s+default: windows\r?$/m);
  });

  it("runs the single optional Windows check for PRs and pushes to main", () => {
    const { block, events } = triggers("windows-light-checks");
    const yaml = readFileSync(new URL("../.github/workflows/windows-light-checks.yml", import.meta.url), "utf8");
    expect(events).toEqual(["pull_request", "push"]);
    expect(block.match(/branches: \[main\]/g)).toHaveLength(2);
    expect(block).not.toMatch(/^\s+paths(?:-ignore)?:/m);
    expect(yaml).toMatch(/permissions:\s+contents: read/);
    expect(yaml).toContain("cancel-in-progress: true");
    expect(yaml).toContain("persist-credentials: false");
    expect(yaml).toContain("package-manager-cache: false");
    expect(yaml).toMatch(/name: Check Rust on Windows\s+if: steps\.plan\.outputs\.rust == 'true'/);
    expect(yaml).toContain("cargo check --locked");
    expect(yaml).not.toMatch(/actions\/cache|rust-cache|pull_request_target|cargo build|bun run (?:build|fetch:pi)/);
  });
});
