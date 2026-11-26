import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as downloads from "../../shared/download-file";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mixed = "\uFEFFe\u0301Ａ\r\n";
const report = JSON.stringify({ codePoints: [{ byteOffset: 0, codePoint: "U+FEFF", utf8: "EF BB BF" }] }, null, 2);

const unicodeFiles = [
  { mode: "inspect", text: mixed, result: report, label: "Download JSON", file: /^unicode-code-points-\d+\.json$/, mime: "application/json" },
  { mode: "nfc", text: mixed, result: "\uFEFFéＡ\r\n", label: "Download normalized text",
    file: /^unicode-nfc-\d+\.txt$/, mime: "text/plain;charset=utf-8" },
  { mode: "nfkc", text: "", result: "", label: "Download normalized text",
    file: /^unicode-nfkc-\d+\.txt$/, mime: "text/plain;charset=utf-8" },
];

it.each(["0.1.2", "0.1.4", "0.1.5"].flatMap(version => unicodeFiles.map(example => ({ ...example, version }))))(
"preserves the input file and downloads a complete $mode result for $version", async example => {
  setLocale("en");
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  const tool: ManualTool = {
    toolId: example.mode, accessId: example.mode, pluginId: "com.zicode.devtools.inspect",
    capabilityId: "devtools.inspect.unicode." + example.mode, title: "Unicode",
    applicationName: "ZiDevTools Inspect", publisher: "ZiDevTools", version: example.version, enabled: true, runtime: "wasi",
  };
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId, version: tool.version, revision: "unicode-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false } },
    })),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: example.result }, error: null } })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="unicode-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  const picker = form.getByLabelText("UTF-8 text file");
  await act(async () => { fireEvent.change(picker, { target: { files: [new NodeFile([example.text], "source.txt")] } }); });
  expect(api.invoke).not.toHaveBeenCalled();
  const execute = form.getByRole("button", { name: "Execute tool" });
  await act(async () => { fireEvent.click(execute); });
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: example.text });
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: example.label }));
  expect(download).toHaveBeenCalledWith(expect.stringMatching(example.file), example.result, example.mime);
  vi.mocked(api.invoke).mockResolvedValueOnce({ result: { ok: false, error: { code: "INPUT_TOO_LARGE" } } });
  await act(async () => { fireEvent.click(execute); });
  expect(view.queryByRole("button", { name: example.label })).toBeNull();
  expect(form.getByRole("textbox", { name: /Source text/ })).toHaveProperty("value", example.text.replaceAll("\r\n", "\n"));
  expect(download).toHaveBeenCalledTimes(1);
});
