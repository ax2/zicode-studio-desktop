import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as downloads from "../../shared/download-file";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("imports the original text body and downloads the complete current report on request", async () => {
  setLocale("en");
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  const tool: ManualTool = {
    toolId: "stats", accessId: "stats", pluginId: "com.zicode.devtools.transforms",
    capabilityId: "devtools.transforms.stats.inspect", title: "Text statistics", applicationName: "ZiDevTools Transforms",
    publisher: "ZiDevTools", version: "0.1.1", enabled: true, runtime: "wasi",
  };
  const text = "中\r\n";
  const report = "UTF-8 字节  5\nUnicode 字符  3\n行数  2\n空白分隔词段  1";
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({ pluginId: tool.pluginId, version: tool.version, revision: "stats-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false } } })),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: report }, error: null } })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="stats-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  const picker = form.getByLabelText("UTF-8 text file");
  const original = new NodeFile(["\uFEFF" + text], "sample.txt");
  await act(async () => { fireEvent.change(picker, { target: { files: [original] } }); });
  expect(api.invoke).not.toHaveBeenCalled();
  const execute = form.getByRole("button", { name: "Execute tool" });
  await act(async () => { fireEvent.click(execute); });
  expect(download).not.toHaveBeenCalled();
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text });
  const label = "Download text statistics";
  fireEvent.click(view.getByRole("button", { name: label }));
  expect(download).toHaveBeenCalledWith(expect.stringMatching(/^text-statistics-\d+\.txt$/), report, "text/plain;charset=utf-8");

  vi.mocked(api.invoke).mockRejectedValueOnce({ code: "worker_cancelled" });
  await act(async () => { fireEvent.click(execute); });
  expect(view.queryByRole("button", { name: label })).toBeNull();
  expect(download).toHaveBeenCalledTimes(1);
});
