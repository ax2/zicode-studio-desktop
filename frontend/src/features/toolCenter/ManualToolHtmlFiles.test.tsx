import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as downloads from "../../shared/download-file";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const text = "<article>中 & 文</article>\r\n";
const escaped = "&lt;article&gt;中 &amp; 文&lt;/article&gt;\r\n";

it.each([
  { op: "escape", input: text, output: escaped, label: "Download escaped text", filename: /^html-escaped-\d+\.txt$/ },
  { op: "unescape", input: escaped, output: text, label: "Download restored text", filename: /^html-restored-\d+\.txt$/ },
  { op: "unescape", input: "", output: "", label: "Download restored text", filename: /^html-restored-\d+\.txt$/ },
])("imports and downloads only the current $op text result", async selected => {
  setLocale("en");
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  const tool: ManualTool = {
    toolId: selected.op, accessId: selected.op, pluginId: "com.zicode.devtools.transforms",
    capabilityId: "devtools.transforms.html." + selected.op, title: "HTML entity conversion", applicationName: "ZiDevTools Transforms",
    publisher: "ZiDevTools", version: "0.1.1", enabled: true, runtime: "wasi",
  };
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId, version: tool.version, revision: "html-entity-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false } },
    })),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: selected.output }, error: null } })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="html-entity-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  const picker = form.getByLabelText<HTMLInputElement>("UTF-8 text file");
  expect(picker.accept).toBe(".html,.htm,.txt");
  await act(async () => { fireEvent.change(picker, { target: { files: [new NodeFile(["\uFEFF" + selected.input], "source.html")] } }); });
  expect(api.invoke).not.toHaveBeenCalled();
  const execute = form.getByRole("button", { name: "Execute tool" });
  await act(async () => { fireEvent.click(execute); });
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: selected.input });
  expect(view.getByRole("textbox", { name: "Tool result" })).toHaveProperty("value", selected.output.replaceAll("\r\n", "\n"));
  expect(view.container.querySelector(".tool-execution-result article")).toBeNull();
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: selected.label }));
  expect(download).toHaveBeenCalledWith(expect.stringMatching(selected.filename), selected.output, "text/plain;charset=utf-8");
  fireEvent.change(form.getByRole("textbox", { name: /Source text/ }), { target: { value: "changed" } });
  expect(view.queryByRole("button", { name: selected.label })).toBeNull();
});
