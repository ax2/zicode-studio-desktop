import { describe, expect, it } from "vitest";
import { isFileWritingTool, toolFilePath } from "./tool-guard.js";

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
