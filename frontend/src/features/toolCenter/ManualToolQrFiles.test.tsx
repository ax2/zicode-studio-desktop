import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

afterEach(cleanup);

it.each(["0.1.0", "0.2.0"])("imports an exact QR text file for Compute %s", async version => {
  setLocale("en");
  const tool: ManualTool = {
    toolId: "qr", accessId: "qr", pluginId: "com.zicode.devtools.compute",
    capabilityId: "devtools.compute.qr.png", title: "QR PNG", applicationName: "ZiDevTools Compute",
    publisher: "ZiDevTools", version, enabled: true, runtime: "wasi",
  };
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId, version: tool.version, revision: "qr-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 }, options: { type: "string", maxLength: 16384 } }, additionalProperties: false } },
    })),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: "sample result" }, error: null } })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="qr-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  const picker = form.getByLabelText<HTMLInputElement>("UTF-8 text file");
  expect(picker.accept).toBe(".txt");
  const text = form.getByRole("textbox", { name: /Source text/ });
  const options = form.getByRole("textbox", { name: /options/i });
  fireEvent.change(text, { target: { value: "initial draft" } });
  fireEvent.change(options, { target: { value: "{}" } });
  const pick = async (...files: NodeFile[]) => { await act(async () => { fireEvent.change(picker, { target: { files } }); }); };
  const original = "\uFEFF合成二维码\r\nLine two\n ";
  const file = new NodeFile([original], "fixture.txt");

  await pick();
  expect(text).toHaveProperty("value", "initial draft");
  await pick(file);
  expect(api.invoke).not.toHaveBeenCalled();
  fireEvent.click(form.getByRole("button", { name: "Undo last import" }));
  expect(text).toHaveProperty("value", "initial draft");
  await pick(file);
  await act(async () => fireEvent.click(form.getByRole("button", { name: "Execute tool" })));
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: original, options: "{}" });
  expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from(original));

  const exact = new NodeFile(["中".repeat(682) + "xy"], "at-limit.txt");
  expect(exact.size).toBe(2048);
  await pick(exact);
  expect(text).toHaveProperty("value", "中".repeat(682) + "xy");
  await pick(new NodeFile(["中".repeat(683)], "over-limit.txt"));
  expect(view.getByRole("alert").textContent).toContain("2 KiB");
  await pick(new NodeFile([new Uint8Array([0xff])], "bad-utf8.txt"));
  expect(view.getByRole("alert").textContent).toContain("valid UTF-8");
  expect(text).toHaveProperty("value", "中".repeat(682) + "xy");
  expect(api.invoke).toHaveBeenCalledTimes(1);
});
