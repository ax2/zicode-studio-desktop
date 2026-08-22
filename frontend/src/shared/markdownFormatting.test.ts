import { describe, expect, it } from "vitest";
import {
  insertMarkdownLinePrefix,
  insertMarkdownLink,
  insertMarkdownTable,
  wrapMarkdownCodeBlock,
  wrapMarkdownSelection,
} from "./markdownFormatting";

describe("markdown formatting helpers", () => {
  it("wraps the selected text and keeps it selected", () => {
    const edit = wrapMarkdownSelection("hello world", 6, 11, "**");
    expect(edit.next).toBe("hello **world**");
    expect(edit.selection).toEqual({ start: 8, end: 13 });
  });

  it("inserts an empty wrapper at the cursor when nothing is selected", () => {
    const edit = wrapMarkdownSelection("hello", 5, 5, "`");
    expect(edit.next).toBe("hello``");
    expect(edit.cursor).toBe(6);
    expect(edit.selection).toBeUndefined();
  });

  it("wraps a code block and places the cursor inside", () => {
    const edit = wrapMarkdownCodeBlock("abc", 3, 3);
    expect(edit.next).toBe("abc```\n\n\n```");
    expect(edit.cursor).toBe(7);
  });

  it("prefixes the current line without doubling the prefix", () => {
    const plain = insertMarkdownLinePrefix("alpha\nbeta", 7, "- ");
    expect(plain.next).toBe("alpha\n- beta");
    const doubled = insertMarkdownLinePrefix("- beta", 6, "- ");
    expect(doubled.next).toBe("- beta");
  });

  it("inserts a localized table skeleton", () => {
    const edit = insertMarkdownTable("head", 5, ["列 1", "列 2"]);
    expect(edit.next).toBe("head| 列 1 | 列 2 |\n|---|---|\n|  |  |");
  });

  it("inserts a link and selects the url placeholder", () => {
    const edit = insertMarkdownLink("see text", 4, 8);
    expect(edit.next).toBe("see [text](url)");
    expect(edit.selection).toEqual({ start: 11, end: 14 });
  });
});
