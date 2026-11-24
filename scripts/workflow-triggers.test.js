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
});