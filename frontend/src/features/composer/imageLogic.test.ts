import { describe, expect, it } from "vitest";
import { filterImageFiles } from "./imageLogic";

describe("composer image logic", () => {
  it("keeps only image files when filtering", () => {
    const files = [
      new File(["a"], "screen.png", { type: "image/png" }),
      new File(["b"], "photo.jpg", { type: "image/jpeg" }),
      new File(["c"], "note.txt", { type: "text/plain" }),
      new File(["d"], "clip", { type: "" }),
    ];
    const filtered = filterImageFiles(files);
    expect(filtered.map((file) => file.name)).toEqual(["screen.png", "photo.jpg"]);
  });

  it("handles null and empty file inputs", () => {
    expect(filterImageFiles(null)).toEqual([]);
    expect(filterImageFiles(undefined)).toEqual([]);
    expect(filterImageFiles([])).toEqual([]);
  });
});
