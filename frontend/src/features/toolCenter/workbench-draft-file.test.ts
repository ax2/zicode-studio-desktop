import { expect, it } from "vitest";
import type { ManualTool } from "./manual-tools";
import { readWorkbenchDraftFile, workbenchDraftFile } from "./workbench-draft-file";

const tool = {
  pluginId: "com.zicode.devtools.compute", capabilityId: "devtools.compute.table.query", version: "0.2.0",
  runtime: "wasi", enabled: true,
} as ManualTool;

function file(source: string | Uint8Array, name = "snapshot.json"): File {
  const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
  return {
    name,
    size: bytes.length,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => new Uint8Array(bytes.subarray(start, end)).buffer,
    }),
  } as File;
}

it("round-trips exact table and options tokens without persisting tool output or private context", async () => {
  const values = { text: ' {"id":18446744073709551615,"a":-9223372036854775808}\r\n',
    options: ' {"format":"json","query":"🧪"} ', result: "unsafe-to-save", path: "private-source" };
  const body = workbenchDraftFile(tool, values)!;
  expect(JSON.parse(body)).toEqual({
    type: "zicode-workbench-draft", schemaVersion: 1, pluginId: tool.pluginId, capabilityId: tool.capabilityId,
    toolVersion: tool.version, inputs: { text: values.text, options: values.options },
  });
  expect(await readWorkbenchDraftFile(file(body), tool)).toEqual({ text: values.text, options: values.options });
});

it("checks exact tool, plugin and version without normalizing unsupported formats", async () => {
  const source = workbenchDraftFile(tool, { options: "incomplete working text" })!;
  expect(await readWorkbenchDraftFile(file(source), tool)).toEqual({ options: "incomplete working text" });
  await expect(readWorkbenchDraftFile(file(source), { ...tool, capabilityId: "devtools.compute.table.json" }))
    .rejects.toThrow("different tool");
  await expect(readWorkbenchDraftFile(file(source.replace('"toolVersion":"0.2.0"', '"toolVersion":"0.3.0"')), tool))
    .rejects.toThrow("different tool");
  await expect(readWorkbenchDraftFile(file(source.replace('"pluginId":"com.zicode.devtools.compute"', '"pluginId":"different"')), tool))
    .rejects.toThrow("different tool");
  await expect(readWorkbenchDraftFile(file(source.replace('"schemaVersion":1', '"schemaVersion":2')), tool))
    .rejects.toThrow("valid ZiCode workbench draft");
  expect(workbenchDraftFile({ ...tool, enabled: false }, { text: "draft" })).toBeNull();
});

it("rejects duplicate, injected and unknown fields as well as malformed and mislabelled files", async () => {
  const source = workbenchDraftFile(tool, { text: "one" })!;
  for (const body of [
    "[]", "null", source.replace('"text":"one"', '"text":1'), source.replace('"text":"one"', '"result":"one"'),
    source.replace('"text":"one"', '"text":"two","text":"one"'),
    source.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    source.replace('"inputs":', '"path":"not-a-path-grant","inputs":'),
  ]) await expect(readWorkbenchDraftFile(file(body), tool)).rejects.toThrow("valid ZiCode workbench draft");
  await expect(readWorkbenchDraftFile(file(source, "ordinary.csv"), tool)).rejects.toThrow("valid ZiCode workbench draft");
  await expect(readWorkbenchDraftFile(file(new Uint8Array([0xff, 0x00])), tool)).rejects.toThrow("valid UTF-8");
});

it("enforces the existing field budgets even across escaped and multi-byte input", async () => {
  const large = { text: "\u0001".repeat(8192), options: "\u0002".repeat(16384) };
  const body = workbenchDraftFile(tool, large)!;
  expect(body.length).toBeGreaterThan(32 * 1024);
  expect(await readWorkbenchDraftFile(file(body), tool)).toEqual(large);
  const accented = "界".repeat(2730);
  expect(workbenchDraftFile(tool, { text: accented + "aa" })).toBeTruthy();
  expect(workbenchDraftFile(tool, { text: accented + "abc" })).toBeNull();
  await expect(readWorkbenchDraftFile(file(" ".repeat(160 * 1024 + 1)), tool)).rejects.toThrow("160 KiB");
  const invalid = JSON.stringify({ ...JSON.parse(body), inputs: { text: "é".repeat(4097) } });
  await expect(readWorkbenchDraftFile(file(invalid), tool)).rejects.toThrow("valid ZiCode workbench draft");
});
