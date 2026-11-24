// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { setLocale } from "../../i18n.js";
import { directoryComparePermission, directoryCompareProfile, isDirectoryCompare, renderDirectoryCompareResult } from "./directory-compare-result.js";

beforeEach(() => setLocale("en"));

const directory = { kind: "directory" };
const file = (logicalBytes = "1") => ({ kind: "file", logicalBytes });

function report(counts = {}, overrides = {}) {
  const differenceCounts = {
    onlyLeft: 0, onlyRight: 0, typeMismatch: 0, sizeMismatch: 0, contentMismatch: 0,
    unverified: 0, changed: 0, readError: 0, ...counts,
  };
  const differenceCount = Object.values(differenceCounts).reduce((sum, value) => sum + value, 0);
  return {
    ok: true, schemaVersion: 1, material: "directory-compare-report", coverageComplete: true,
    partial: false, limitReasons: [], totalPaths: differenceCount, sameFiles: 0, sameDirectories: 0,
    unassessedOneSide: 0, differenceCount, differenceCounts, rows: [], projectionTruncated: false,
    ...overrides,
  };
}

function fixture(value) {
  const root = document.createElement("div");
  const rendered = renderDirectoryCompareResult(root, value);
  return { root, rendered, text: root.textContent };
}

it("recognizes only the Directory Compare identity and profile", () => {
  const plugin = "com.zicode.devtools.directory-compare";
  const scan = "devtools.directory-compare.scan";
  expect(isDirectoryCompare(plugin, scan)).toBe(true);
  expect(isDirectoryCompare(plugin, scan + ".other")).toBe(false);
  expect(isDirectoryCompare(plugin + "-other", scan)).toBe(false);
  expect(directoryCompareProfile).toBe("resource.local-directory.compare.draft1");
  expect(directoryComparePermission).toBe("resource.directory.compare.read");
});

it("groups confirmed differences, preserves relative path text, and displays exact size", () => {
  const path = "子目录/<mark>.txt";
  const { root, rendered, text } = fixture(report({
    onlyLeft: 1, onlyRight: 1, typeMismatch: 1, sizeMismatch: 1, contentMismatch: 1,
  }, {
    totalPaths: 8, sameFiles: 2, sameDirectories: 1,
    rows: [
      { path, difference: "onlyLeft", left: file("18446744073709551615") },
      { path: "right-only.txt", difference: "onlyRight", left: null, right: file() },
      { path: "different-kind", difference: "typeMismatch", left: file(), right: directory },
      { path: "different-size", difference: "sizeMismatch", left: file(), right: file("2") },
      { path: "different-content", difference: "contentMismatch", left: file(), right: file() },
    ],
  }));
  expect(rendered).toBe(true);
  expect([...root.querySelectorAll("summary")].map(element => element.textContent)).toEqual([
    "Only on the left · 1", "Only on the right · 1", "Different entry types · 1",
    "Different file sizes · 1", "Different file contents · 1",
  ]);
  expect(root.querySelector("bdi")?.textContent).toBe(path);
  expect(root.querySelector("mark")).toBeNull();
  expect(root.querySelector("a, button, input")).toBeNull();
  expect(text).toContain("18,446,744,073,709,551,615 B");
  expect(text).toContain("Right · No entry");
  expect(text).toContain("Confirmed differences5");
  expect(text).toContain("Matching file contents2");
});

it("keeps incompletely scanned one-sided paths and uncertain results separate from confirmed differences", () => {
  const { rendered, text, root } = fixture(report({ unverified: 1, changed: 1, readError: 1 }, {
    coverageComplete: false, partial: true, totalPaths: 5, unassessedOneSide: 2,
    limitReasons: ["entries", "new_safe_limit"],
    rows: [
      { path: "seen.txt", difference: "unverified", left: file() },
      { path: "changed.txt", difference: "changed", left: file(), right: file() },
      { path: "opaque.txt", difference: "readError", left: file(), right: file() },
    ],
  }));
  expect(rendered).toBe(true);
  expect(text).toContain("Folder coverage is incomplete.");
  expect(text).toContain("No confirmed differences among the paths checked.");
  expect(text).toContain("Unresolved paths5");
  expect(text).toContain("Paths seen on one side but unassessed on the other2");
  expect(text).toContain("Right · Not assessed");
  expect(text).not.toContain("No entry");
  expect(text).toContain("Entry limit reached.");
  expect(text).toContain("Another scan limit was reached.");
  expect(text).not.toContain("new_safe_limit");
  expect(root.querySelectorAll("details")).toHaveLength(3);
});

it("shows complete listings separately from a partial file comparison and a shortened report", () => {
  const { rendered, text } = fixture(report({ sizeMismatch: 1, readError: 1 }, {
    partial: true, limitReasons: ["read_error"], projectionTruncated: true,
    rows: [{ path: "kept.txt", difference: "sizeMismatch", left: file(), right: file("2") }],
  }));
  expect(rendered).toBe(true);
  expect(text).toContain("Both folder listings are complete.");
  expect(text).toContain("Some comparisons could not be confirmed.");
  expect(text).toContain("The report shows 1 of 2 difference rows.");
  expect(text).toContain("Confirmed differences1");
  expect(text).toContain("Unresolved paths1");

  const same = fixture(report({}, { totalPaths: 2, sameFiles: 1, sameDirectories: 1 }));
  expect(same.rendered).toBe(true);
  expect(same.text).toContain("No differences among the compared paths.");
});

it.each(["C:/private.txt", "/root/private.txt", "sub/../private.txt", "sub\\private.txt", "bad\u0000name"])(
  "rejects a malformed path and clears the previous report",
  path => {
    const root = document.createElement("div");
    root.textContent = "old report";
    const invalid = report({ onlyLeft: 1 }, { rows: [{ path, difference: "onlyLeft", left: file() }] });
    expect(renderDirectoryCompareResult(root, invalid)).toBe(false);
    expect(root.textContent).toBe("");
  },
);

it("rejects contradictory counts, folder coverage and sizes", () => {
  const rows = [{ path: "a.txt", difference: "onlyLeft", left: file() }];
  expect(fixture(report({ onlyLeft: 1 }, { rows, differenceCount: 2 })).rendered).toBe(false);
  expect(fixture(report({ onlyLeft: 1 }, { rows, coverageComplete: false, partial: true })).rendered).toBe(false);
  expect(fixture(report({ onlyLeft: 1 }, {
    rows: [{ ...rows[0], left: file("18446744073709551616") }],
  })).rendered).toBe(false);
});
