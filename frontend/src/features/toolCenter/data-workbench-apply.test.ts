import { expect, it, vi } from "vitest";
import { prepareWorkbenchApply } from "./data-workbench-apply";

const source = {
  text: "original",
  options: '{"format":"json","query":"match","sort":"id","descending":false}',
};
const report = (format: string, columns: string[], text: string, selected = 1) =>
  JSON.stringify({ format, columns, text, inputRows: 2, selectedRows: selected });

it("retains output column order, exact number tokens and empty tables as reusable JSON", () => {
  const operation = "devtools.compute.table.json";
  const columns = ["id", "0", "flag"];
  const rows = '[{"0":{"n":18446744073709551615},"flag":true,"id":-9223372036854775808}]';
  const actual = prepareWorkbenchApply(operation, source, report("json", columns, rows));
  expect(actual).toEqual({
    format: "json",
    options: source.options,
    text: '{"headers":["id","0","flag"],"rows":[[-9223372036854775808,{"n":18446744073709551615},true]]}',
  });
  expect(prepareWorkbenchApply(operation, source, report("json", columns, "[]", 0))?.text).toBe(
    '{"headers":["id","0","flag"],"rows":[]}',
  );
  expect(
    prepareWorkbenchApply(operation, source, report("json", columns, '[{"id":1}]')),
  ).toBeNull();
});

it("uses quoted, delimited result bytes and only changes the input format", () => {
  const options = '{"format":"json","query":"match","sort":"id","descending":true,"output":"tsv"}';
  const text = 'id\tvalue\n18446744073709551615\t"a\r\nb"\n';
  const actual = prepareWorkbenchApply(
    "devtools.compute.table.query",
    { ...source, options },
    report("tsv", ["id", "value"], text),
  );
  expect(actual).toEqual({
    format: "tsv",
    text,
    options: '{"format":"tsv","query":"match","sort":"id","descending":true,"output":"tsv"}',
  });
});

it("rejects outputs over the byte budget, from another operation, or with invalid shape", () => {
  const operation = "devtools.compute.table.csv";
  const limit = "id\n" + "x".repeat(8188) + "\n";
  expect(prepareWorkbenchApply(operation, source, report("csv", ["id"], limit))?.text).toBe(limit);
  expect(
    prepareWorkbenchApply(operation, source, report("csv", ["id"], limit.replace("x", "中"))),
  ).toBeNull();
  expect(prepareWorkbenchApply(operation, source, report("tsv", ["id"], limit))).toBeNull();
  expect(prepareWorkbenchApply(operation, source, report("csv", ["id", "id"], limit))).toBeNull();
  expect(prepareWorkbenchApply(operation, source, report("csv", ["other"], limit))).toBeNull();
});

it("keeps JSON view-only if the engine cannot supply the exact numeric tokens", () => {
  const original = JSON.parse;
  const older = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) =>
    reviver
      ? original(text, function (this: unknown, key, value) {
          return reviver.call(this, key, value);
        })
      : original(text),
  );
  try {
    expect(
      prepareWorkbenchApply(
        "devtools.compute.table.json",
        source,
        report("json", ["id"], '[{"id":1}]'),
      ),
    ).toBeNull();
  } finally {
    older.mockRestore();
  }
});
