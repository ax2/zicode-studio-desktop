import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as downloads from "../../shared/download-file";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([
  { mode: "java", extension: "log", stem: "java-trace", text: "java.lang.IllegalStateException: 合成日志\r\nCaused by: java.io.IOException: missing sample\r\n" },
  { mode: "django", extension: "traceback", stem: "python-trace", text: "Traceback (most recent call last):\r\n  File \"sample.py\", line 4, in run\r\nValueError: 合成日志\r\n" },
])("imports local $mode logs and saves only the current complete report", async example => {
  setLocale("en");
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  const report = '{\n  "notes": "合成报告",\n  "frames": []\n}';
  const tool: ManualTool = {
    toolId: example.mode, accessId: example.mode, pluginId: "com.zicode.devtools.trace",
    capabilityId: `devtools.trace.${example.mode}.trace`, title: "Stack trace",
    applicationName: "ZiDevTools Trace", publisher: "ZiDevTools", version: "0.1.1", enabled: true, runtime: "wasi",
  };
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId, version: tool.version, revision: "trace-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false } },
    })),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: report }, error: null } })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="trace-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  const picker = form.getByLabelText<HTMLInputElement>("Log file");
  const source = form.getByRole("textbox", { name: /Source text/ });
  const file = new NodeFile(["\uFEFF" + example.text], `diagnostic.${example.extension}`);
  const pick = async (...files: NodeFile[]) => { await act(async () => { fireEvent.change(picker, { target: { files } }); }); };
  expect(picker.accept).toBe(".log,.txt,.traceback");
  fireEvent.change(source, { target: { value: "original draft" } });
  await pick();
  expect(source).toHaveProperty("value", "original draft");
  await pick(file);
  expect(api.invoke).not.toHaveBeenCalled();
  fireEvent.click(form.getByRole("button", { name: "Undo last import" }));
  expect(source).toHaveProperty("value", "original draft");
  await pick(file);
  const execute = form.getByRole("button", { name: "Execute tool" });
  await act(async () => { fireEvent.click(execute); });
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: example.text });
  expect(view.getByRole("textbox", { name: "Tool result" })).toHaveProperty("value", report);
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Download JSON" }));
  expect(download).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${example.stem}-\\d+\\.json$`)), report, "application/json");
  fireEvent.change(source, { target: { value: "edited draft" } });
  expect(view.queryByRole("button", { name: "Download JSON" })).toBeNull();
  await pick(new NodeFile([new Uint8Array([255])], "invalid.log"));
  expect(view.getByRole("alert").textContent).toContain("valid UTF-8");
  await pick(new NodeFile(["x".repeat(8193)], "large.log"));
  expect(view.getByRole("alert").textContent).toContain("8 KiB");
  expect(source).toHaveProperty("value", "edited draft");
  vi.mocked(api.invoke).mockResolvedValueOnce({ result: { ok: false, error: { code: "INPUT_TOO_LARGE" } } });
  await act(async () => { fireEvent.click(execute); });
  expect(view.queryByRole("button", { name: "Download JSON" })).toBeNull();
  expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from("\uFEFF" + example.text));
  expect(download).toHaveBeenCalledTimes(1);
});
