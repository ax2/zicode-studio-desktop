import {File as NodeFile} from "node:buffer";
import {act, cleanup, fireEvent, render, within} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import * as downloads from "../../shared/download-file";
import {setLocale} from "../../shared/i18n";
import {ManualToolDetail} from "./ManualToolDetail";
import {readManualToolFile} from "./manual-tool-file";
import type {ManualTool, ManualToolApi} from "./manual-tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("imports literal line breaks and downloads a valid empty result only on request", async () => {
  setLocale("en");
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  const tool: ManualTool = {
    toolId: "nonempty", accessId: "nonempty", pluginId: "com.zicode.devtools.transforms",
    capabilityId: "devtools.transforms.lines.nonempty", title: "Remove empty lines",
    applicationName: "ZiDevTools Transforms", publisher: "ZiDevTools", version: "0.1.1", enabled: true, runtime: "wasi",
  };
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId, version: tool.version, revision: "line-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false } },
    })),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: "" }, error: null } })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="line-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  const input = " \r\n\t\r\n";
  const source = new NodeFile(["\uFEFF" + input], "source.log");
  const picker = form.getByLabelText("UTF-8 text file");
  await act(async () => { fireEvent.change(picker, { target: { files: [source] } }); });
  expect(api.invoke).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(form.getByRole("button", { name: "Execute tool" })); });
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: input });
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Download processed text" }));
  expect(download).toHaveBeenCalledWith(expect.stringMatching(/^processed-\d+\.txt$/), "", "text/plain;charset=utf-8");
  fireEvent.change(form.getByRole("textbox", { name: /Source text/ }), { target: { value: "new input" } });
  expect(view.queryByRole("button", { name: "Download processed text" })).toBeNull();
});

it("keeps the actual 8 KiB UTF-8 file boundary including BOM", async () => {
  const file = (text: string) => new NodeFile([text], "sample.log") as unknown as File;
  const boundary = "界".repeat(2729) + "xy";
  await expect(readManualToolFile(file("\uFEFF" + boundary), {}, "utf8-text")).resolves.toEqual({ text: boundary });
  await expect(readManualToolFile(file("\uFEFF" + boundary + "!"), {}, "utf8-text")).rejects.toThrow("8 KiB");
});
