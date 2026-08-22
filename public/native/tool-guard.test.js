import { describe, expect, it } from "vitest";
import { isFileWritingTool, toolChangeInfo, toolFilePath } from "./tool-guard.js";

describe("isFileWritingTool", () => {
  it("classifies write-like tools", () => {
    expect(isFileWritingTool("Write")).toBe(true);
    expect(isFileWritingTool("edit_file")).toBe(true);
    expect(isFileWritingTool("createFile")).toBe(true);
    expect(isFileWritingTool("apply_patch")).toBe(true);
    expect(isFileWritingTool("web_search")).toBe(false);
    expect(isFileWritingTool("read_file")).toBe(false);
  });
});

describe("toolFilePath", () => {
  it("resolves the file path from common argument shapes", () => {
    expect(toolFilePath({ path: "a.md" })).toBe("a.md");
    expect(toolFilePath({ file_path: "b.md" })).toBe("b.md");
    expect(toolFilePath({ filePath: "c.md" })).toBe("c.md");
    expect(toolFilePath({})).toBe("");
  });
});

describe("toolChangeInfo", () => {
  it("captures before/after content for edit tools", () => {
    expect(
      toolChangeInfo("edit", { oldText: "old", newText: "new" }),
    ).toEqual({
      kind: "edit",
      before: "old",
      after: "new",
      hasDiff: true,
    });
    expect(
      toolChangeInfo("apply_patch", { old_text: "a", new_text: "b" }),
    ).toMatchObject({ kind: "edit", before: "a", after: "b" });
  });

  it("captures new content for write and append tools", () => {
    expect(toolChangeInfo("Write", { content: "hello" })).toEqual({
      kind: "write",
      before: "",
      after: "hello",
      hasDiff: true,
    });
    expect(toolChangeInfo("append_file", { text: "tail" })).toEqual({
      kind: "append",
      before: "",
      after: "tail",
      hasDiff: true,
    });
  });

  it("returns no diff for unknown tools or missing content", () => {
    expect(toolChangeInfo("web_search", { query: "x" })).toEqual({
      kind: "other",
      before: "",
      after: "",
      hasDiff: false,
    });
    expect(toolChangeInfo("write_file", { path: "a.md" })).toMatchObject({
      kind: "write",
      hasDiff: false,
    });
  });
});
