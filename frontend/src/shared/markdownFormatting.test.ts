import { describe, expect, it } from "vitest";
import {
  csvToMarkdownTable,
  insertMarkdownLinePrefix,
  insertMarkdownLink,
  insertMarkdownTable,
  replaceSelection,
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

  it("converts CSV text into a Markdown table", () => {
    const table = csvToMarkdownTable("name,age\nAlice,30\nBob,25");
    expect(table).toBe(
      "| name | age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |",
    );
  });

  it("pads ragged CSV rows and escapes pipes", () => {
    const table = csvToMarkdownTable("a,b,c\n1,2\nx|y,3,4");
    expect(table).toContain("| 1 | 2 |  |");
    expect(table).toContain("| x\\|y | 3 | 4 |");
  });

  it("returns empty for blank CSV input", () => {
    expect(csvToMarkdownTable("\n  \n")).toBe("");
  });

  it("replaces the selected range with the conversion", () => {
    const edit = replaceSelection("before\na,b\nc,d\nafter", 7, 14, "| a | b |\n| --- | --- |\n| c | d |");
    expect(edit.next).toBe("before\n| a | b |\n| --- | --- |\n| c | d |\nafter");
  });
});
