import { describe, expect, it } from "vitest";
import { mergeMemoryEntries, parseMemoryExtractAnswer } from "./memory-extract.js";

describe("parseMemoryExtractAnswer", () => {
  it("parses a bare JSON array", () => {
    expect(parseMemoryExtractAnswer('["A", "B", " C "]')).toEqual(["A", "B", "C"]);
  });

  it("parses a fenced JSON block with surrounding prose", () => {
    const answer = 'Here are the memories:\n```json\n["x", "y"]\n```\nDone.';
    expect(parseMemoryExtractAnswer(answer)).toEqual(["x", "y"]);
  });

  it("falls back to list lines and ignores empty results", () => {
    expect(parseMemoryExtractAnswer("")).toEqual([]);
    expect(parseMemoryExtractAnswer("- one\n- two\n")).toEqual(["one", "two"]);
  });
});

describe("mergeMemoryEntries", () => {
  it("drops exact and contained duplicates", () => {
    const existing = [{ id: "m1", text: "prefers Chinese" }];
    const merged = mergeMemoryEntries(existing, ["prefers Chinese", "prefers concise replies"]);
    expect(merged).toHaveLength(2);
    expect(merged[0].text).toBe("prefers Chinese");
    expect(merged[1].text).toBe("prefers concise replies");
  });

  it("skips entries contained in existing text", () => {
    const existing = [{ id: "m1", text: "user prefers concise Chinese replies" }];
    const merged = mergeMemoryEntries(existing, ["prefers concise"]);
    expect(merged).toHaveLength(1);
  });
});
