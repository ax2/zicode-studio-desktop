import { describe, expect, it } from "vitest";
import { matchesSearchQuery, matchesSearchTerms, prepareSearchQuery } from "./catalog-search";

describe("catalog metadata search", () => {
  it("matches distinct terms across Chinese and normalized metadata fields", () => {
    expect(matchesSearchQuery("中文 ＪＳＯＮ", ["中文格式化", "Process JSON locally"])).toBe(true);
    expect(matchesSearchQuery("中文 Django", ["中文格式化", "Process JSON locally"])).toBe(false);
    expect(prepareSearchQuery("JSON json ＪＳＯＮ")).toEqual(["json"]);
  });
  it("keeps queries literal and never invents a cross-field match", () => {
    expect(matchesSearchQuery(".*", ["Format JSON"])).toBe(false);
    expect(matchesSearchQuery("abc", ["ab", "c"])).toBe(false);
    expect(matchesSearchQuery("", [undefined, null])).toBe(true);
    expect(matchesSearchQuery("x", [undefined, null])).toBe(false);
  });
  it.each([100, 500, 1000])("filters %i synthetic entries without dropping identities", (count) => {
    const items = Array.from({ length: count }, (_, index) => ({
      id: String(index),
      label: index % 10 === 0 ? "JSON 格式化" : "Other",
    }));
    const terms = prepareSearchQuery("json 格式化");
    const selected = items.filter((item) => matchesSearchTerms(terms, [item.label]));
    expect(selected).toHaveLength(count / 10);
    expect(new Set(selected.map((item) => item.id)).size).toBe(selected.length);
    expect(items).toHaveLength(count);
  });
});
