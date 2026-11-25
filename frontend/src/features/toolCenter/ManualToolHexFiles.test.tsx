import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as downloads from "../../shared/download-file";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const source = "\uFEFF中\r\n";
const hex = "EF BB BF E4 B8 AD 0D 0A";
const wrapped = "ef bb bf\r\ne4 b8 ad\t0d 0a";

it.each([
  { op: "encode", file: source, input: source, output: hex, picker: "UTF-8 text file", action: "Download Hex text",
    filename: /^hex-bytes-\d+\.txt$/, mime: "text/plain" },
  { op: "decode", file: "\uFEFF" + wrapped, input: wrapped, output: source, picker: "Hex text file", action: "Download decoded text",
    filename: /^hex-decoded-\d+\.txt$/, mime: "text/plain;charset=utf-8" },
  { op: "decode", file: "", input: "", output: "", picker: "Hex text file", action: "Download decoded text",
    filename: /^hex-decoded-\d+\.txt$/, mime: "text/plain;charset=utf-8" },
])("keeps the exact $op file and result semantics", async selected => {
  setLocale("en");
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  const tool: ManualTool = {
    toolId: selected.op, accessId: selected.op, pluginId: "com.zicode.devtools.transforms",
    capabilityId: "devtools.transforms.hex." + selected.op, title: "Hex conversion",
    applicationName: "ZiDevTools Transforms", publisher: "ZiDevTools", version: "0.1.1", enabled: true, runtime: "wasi",
  };
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId, version: tool.version, revision: "hex-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false } },
    })),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: selected.output }, error: null } })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="hex-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  const original = new NodeFile([selected.file], "source.txt");
  await act(async () => {
    fireEvent.change(form.getByLabelText(selected.picker), { target: { files: [original] } });
  });
  expect(api.invoke).not.toHaveBeenCalled();
  const execute = form.getByRole("button", { name: "Execute tool" });
  await act(async () => { fireEvent.click(execute); });
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: selected.input });
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: selected.action }));
  expect(download).toHaveBeenCalledWith(expect.stringMatching(selected.filename), selected.output, selected.mime);
});
