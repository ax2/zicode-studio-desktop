import assert from "node:assert/strict";
import test from "node:test";
import { domains } from "../public/locales/zh-CN/index.js";
import { dictionaryErrors } from "./i18n-dictionary-errors.mjs";

test("identifies both owners of a duplicate and the owner of missing text or changed placeholders", () => {
  assert.deepEqual(dictionaryErrors({
    blog: { Preview: "预览", "Sync {count} articles": "同步 {count} 篇文章" },
    notes: { Preview: "预览", Empty: "", Label: "Label", "Restored {count}": "已恢复 {total}" },
  }), [
    "zh-CN/notes: Preview also appears in zh-CN/blog",
    "zh-CN/notes: Empty needs a translation",
    "zh-CN/notes: Label needs a translation",
    "zh-CN/notes: Restored {count} has different placeholders in its translation",
  ]);
});

test("shipped domains have unique keys, translated values, and the same placeholders as the source", () => {
  assert.deepEqual(dictionaryErrors(domains), []);
});
