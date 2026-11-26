import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as downloads from "../../shared/download-file";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import { readManualToolFile } from "./manual-tool-file";
import type { ManualTool, ManualToolApi } from "./manual-tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const file = (name: string, text: string) => new NodeFile([text], name);
const text = "\uFEFF原文\r\n";
const base64 = Buffer.from(text).toString("base64");

it.each([
  { version: "0.4.1", op: "encode", inputLabel: "UTF-8 text file", action: "Download Base64 file", filename: /^encoded-\d+\.base64$/,
    fileText: text, input: text, output: base64, mime: "text/plain" },
  { version: "0.4.1", op: "decode", inputLabel: "Base64 input file", action: "Download decoded text", filename: /^decoded-\d+\.txt$/,
    fileText: "\uFEFF" + base64.slice(0, 4) + "\r\n" + base64.slice(4), input: base64, output: text, mime: "text/plain;charset=utf-8" },
  { version: "0.4.2", op: "decode", inputLabel: "Base64 input file", action: "Download decoded text", filename: /^decoded-\d+\.txt$/,
    fileText: "", input: "", output: "", mime: "text/plain;charset=utf-8" },
  { version: "0.4.3", op: "encode", inputLabel: "UTF-8 text file", action: "Download Base64 file", filename: /^encoded-\d+\.base64$/,
    fileText: text, input: text, output: base64, mime: "text/plain" },
  { version: "0.4.4", op: "decode", inputLabel: "Base64 input file", action: "Download decoded text", filename: /^decoded-\d+\.txt$/,
    fileText: base64, input: base64, output: text, mime: "text/plain;charset=utf-8" },
])("imports and downloads only after an explicit action for $op", async selected => {
  setLocale("en");
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  const tool: ManualTool = {
    toolId: selected.op, accessId: selected.op, pluginId: "com.zicode.devtools.text",
    capabilityId: "devtools.text.base64." + selected.op, title: "Base64", applicationName: "ZiDevTools Text",
    publisher: "ZiDevTools", version: selected.version, enabled: true, runtime: "wasi",
  };
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId, version: tool.version, revision: "base64-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false } },
    })),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: selected.output }, error: null } })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="base64-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  await act(async () => {
    fireEvent.change(form.getByLabelText(selected.inputLabel), { target: { files: [file("fixture.txt", selected.fileText)] } });
  });
  expect(api.invoke).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(form.getByRole("button", { name: "Execute tool" })); });
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: selected.input });
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: selected.action }));
  expect(download).toHaveBeenCalledWith(expect.stringMatching(selected.filename), selected.output, selected.mime);
});

it("limits raw file bytes and preserves spaces for the strict Base64 decoder", async () => {
  const exact = "A".repeat(8189);
  const selected = (value: string) => file("encoded.base64", value) as unknown as File;
  await expect(readManualToolFile(selected("\uFEFF" + exact), {}, "utf8-bytes")).resolves.toEqual({ text: "\uFEFF" + exact });
  await expect(readManualToolFile(selected("\uFEFF" + exact + "\n"), {}, "base64-decode")).rejects.toThrow("8 KiB");
  await expect(readManualToolFile(selected("\uFEFFAB\r\n C\t\nD "), {}, "base64-decode")).resolves.toEqual({ text: "AB C\tD " });
});
