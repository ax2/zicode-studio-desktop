import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as downloads from "../../shared/download-file";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import { readManualToolFile } from "./manual-tool-file";
import type { ManualTool, ManualToolApi } from "./manual-tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const source = "  https://docs.invalid/p?x=1&x=%2B#f  \r\n";
const file = (text: string) => new NodeFile([text], "url.txt");

it("keeps one URL as in the file and rejects a second line", async () => {
  const read = (text: string) => readManualToolFile(file(text) as unknown as File, {}, "url-inspect");
  await expect(read("\uFEFF" + source)).resolves.toEqual({ text: source });
  await expect(read(source + "http://docs.invalid/another")).rejects.toThrow("containing one URL");
  await expect(read(" \r\n")).rejects.toThrow("containing one URL");
});

it("downloads the complete current report only after a user click", async () => {
  setLocale("en");
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  const tool: ManualTool = {
    toolId: "url", accessId: "url", pluginId: "com.zicode.devtools.transforms",
    capabilityId: "devtools.transforms.url.inspect", title: "URL inspector", applicationName: "ZiDevTools Transforms",
    publisher: "ZiDevTools", version: "0.1.1", enabled: true, runtime: "wasi",
  };
  const report = JSON.stringify({ query: [{ key: "x", value: "1" }, { key: "x", value: "+" }] }, null, 2);
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId, version: tool.version, revision: "url-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false } },
    })),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: report }, error: null } })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="url-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  await act(async () => { fireEvent.change(form.getByLabelText("URL text file"), { target: { files: [file("\uFEFF" + source)] } }); });
  expect(api.invoke).not.toHaveBeenCalled();
  const run = form.getByRole("button", { name: "Execute tool" });
  await act(async () => { fireEvent.click(run); });
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: source });
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Download JSON" }));
  expect(download).toHaveBeenCalledWith(expect.stringMatching(/^url-details-\d+\.json$/), report, "application/json");
  vi.mocked(api.invoke).mockResolvedValueOnce({ result: { ok: false, error: { code: "INVALID_INPUT" } } });
  await act(async () => { fireEvent.click(run); });
  expect(view.queryByRole("button", { name: "Download JSON" })).toBeNull();
  expect(download).toHaveBeenCalledTimes(1);
});
