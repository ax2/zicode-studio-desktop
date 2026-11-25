import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as downloads from "../../shared/download-file";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const text = "中\r\n\"quoted\" \\";
const literal = JSON.stringify(text);

it.each([
  { op: "escape", input: text, output: literal, picker: "UTF-8 text file", action: "Download JSON",
    filename: /^escaped-string-\d+\.json$/, mime: "application/json" },
  { op: "unescape", input: '""', output: "", picker: "JSON string file", action: "Download restored text",
    filename: /^restored-string-\d+\.txt$/, mime: "text/plain;charset=utf-8" },
])("imports a file and downloads only the current $op result", async selected => {
  setLocale("en");
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  const tool: ManualTool = {
    toolId: selected.op, accessId: selected.op, pluginId: "com.zicode.devtools.transforms",
    capabilityId: "devtools.transforms.string." + selected.op, title: "JSON string", applicationName: "ZiDevTools Transforms",
    publisher: "ZiDevTools", version: "0.1.1", enabled: true, runtime: "wasi",
  };
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId, version: tool.version, revision: "string-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false } },
    })),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: selected.output }, error: null } })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="string-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  const inputFile = new NodeFile(["\uFEFF" + selected.input], "source.txt");
  await act(async () => {
    fireEvent.change(form.getByLabelText(selected.picker), { target: { files: [inputFile] } });
  });
  expect(api.invoke).not.toHaveBeenCalled();
  const execute = form.getByRole("button", { name: "Execute tool" });
  await act(async () => { fireEvent.click(execute); });
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: selected.input });
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: selected.action }));
  expect(download).toHaveBeenCalledWith(expect.stringMatching(selected.filename), selected.output, selected.mime);

  vi.mocked(api.invoke).mockResolvedValueOnce({ result: { ok: false, error: { code: "INVALID_INPUT" } } });
  await act(async () => { fireEvent.click(execute); });
  expect(view.queryByRole("button", { name: selected.action })).toBeNull();
  expect(download).toHaveBeenCalledTimes(1);
});
