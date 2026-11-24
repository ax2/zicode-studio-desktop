import { expect, it, vi } from "vitest";
import { prepareMergeApply } from "./data-merge-apply";
import { dataMergePreview } from "./data-transform-result";
import { toolFields } from "./manual-tool-fields";

const report = (rows: string) =>
  `{"report":"Merged","data":{"headers":["id"],"rows":${rows}},"csv":"id"}`;
const fields = toolFields({
  type: "object",
  required: ["left", "right", "leftFormat", "rightFormat"],
  properties: {
    left: { type: "string", maxLength: 8192 },
    right: { type: "string", maxLength: 8192 },
    leftFormat: { type: "string", enum: ["json", "csv"] },
    rightFormat: { type: "string", enum: ["csv", "json"] },
  },
});
if (!fields) throw new Error("Invalid fixture schema");
const draft = { left: "id\n1", leftFormat: "1", right: "id\n2", rightFormat: "0" };

it("uses the selected format field and its actual JSON choice at exactly 8192 bytes", () => {
  const empty = '{"headers":["id"],"rows":[[""]]}';
  const exact = empty.replace('""', '"' + "x".repeat(8192 - empty.length) + '"');
  expect(exact.length).toBe(8192);
  expect(prepareMergeApply("left", fields, draft, exact)).toEqual({ left: exact, leftFormat: "0" });
  expect(prepareMergeApply("right", fields, draft, exact)).toEqual({
    right: exact,
    rightFormat: "1",
  });
  expect(prepareMergeApply("right", fields, draft, exact.replace("x", "中"))).toBeNull();
  expect(prepareMergeApply("right", fields, draft, null)).toBeNull();
});

it("retains original numeric tokens in nested cells and valid header-only results", () => {
  expect(dataMergePreview(report('[[{"amount":[18446744073709551615,1e-8]}]]'), true)?.input).toBe(
    '{"headers":["id"],"rows":[[{"amount":[18446744073709551615,1e-8]}]]}',
  );
  expect(dataMergePreview(report("[]"), true)?.input).toBe('{"headers":["id"],"rows":[]}');
});

it("keeps view-only results when the engine has no exact token source", () => {
  const original = JSON.parse;
  const older = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) =>
    reviver
      ? original(text, function (this: unknown, key, value) {
          return reviver.call(this, key, value);
        })
      : original(text),
  );
  try {
    const preview = dataMergePreview(report("[[1]]"), true);
    expect(preview?.rows[0].cells).toEqual(["1"]);
    expect(preview?.input).toBeNull();
    expect(dataMergePreview(report("[[18446744073709551615]]"), true)).toBeNull();
  } finally {
    older.mockRestore();
  }
});
