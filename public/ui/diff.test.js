import { describe, expect, it } from "vitest";
import { diffLines } from "./diff.js";

describe("diffLines", () => {
  it("marks all new lines as additions for an empty before", () => {
    expect(diffLines("", "a\nb")).toEqual([
      { kind: "added", text: "+ a" },
      { kind: "added", text: "+ b" },
    ]);
  });

  it("marks all old lines as removals for an empty after", () => {
    expect(diffLines("a\nb", "")).toEqual([
      { kind: "removed", text: "- a" },
      { kind: "removed", text: "- b" },
    ]);
  });

  it("keeps unchanged lines out of the edit script", () => {
    expect(diffLines("a\nb\nc", "a\nc\nd")).toEqual([
      { kind: "removed", text: "- b" },
      { kind: "added", text: "+ d" },
    ]);
  });

  it("returns an empty script for identical text", () => {
    expect(diffLines("same\nlines", "same\nlines")).toEqual([]);
  });

  it("normalizes CRLF line endings", () => {
    expect(diffLines("a\r\nb", "a\nc")).toEqual([
      { kind: "removed", text: "- b" },
      { kind: "added", text: "+ c" },
    ]);
  });
});
