import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as downloads from "../../shared/download-file";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import { readManualToolFile } from "./manual-tool-file";
import type { ManualTool, ManualToolApi } from "./manual-tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const envelope = (text: string) => ({ contractVersion: "1.0.0-rc.1", ok: true, data: { text }, error: null });
const file = (name: string, text: string) => new NodeFile([text], name);

const yamlFiles = [
  { op: "to_json", inputLabel: "YAML input file", name: "fixture.YML", accept: ".yaml,.yml", ext: "json", mime: "application/json",
    source: "wide: 9007199254740993\r\n", expected: "{\n  \"wide\": 9007199254740993\n}" },
  { op: "from_json", inputLabel: "JSON input file", name: "fixture.JSON", accept: ".json", ext: "yaml", mime: "application/yaml",
    source: "{\r\n  \"wide\": 9007199254740993\r\n}", expected: "wide: 9007199254740993\n" },
];
const inspectVersions = ["0.1.2", "0.1.4"];

it.each(inspectVersions.flatMap(version => yamlFiles.map(selected => ({ ...selected, version }))))(
"uses the appropriate file and exact result bytes for $op with Inspect $version", async selected => {
  setLocale("en");
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  const tool: ManualTool = {
    toolId: selected.op, accessId: selected.op, pluginId: "com.zicode.devtools.inspect",
    capabilityId: "devtools.inspect.yaml." + selected.op, title: "Converter", applicationName: "ZiDevTools Inspect",
    publisher: "ZiDevTools", version: selected.version, enabled: true, runtime: "wasi",
  };
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId, version: tool.version, revision: "yaml-revision", enabled: true, permissions: [],
      capability: { id: tool.capabilityId, inputSchema: { type: "object", required: ["text"],
        properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false } },
    })),
    invoke: vi.fn(async () => ({ result: envelope(selected.expected) })),
  };
  const view = render(<ManualToolDetail tool={tool} revision="yaml-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  const picker = form.getByLabelText<HTMLInputElement>(selected.inputLabel);
  expect(picker.accept).toBe(selected.accept);
  await act(async () => { fireEvent.change(picker, { target: { files: [file(selected.name, "\uFEFF" + selected.source)] } }); });
  expect(api.invoke).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(form.getByRole("button", { name: "Execute tool" })); });
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: selected.source });
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Download " + selected.ext.toUpperCase() }));
  expect(download).toHaveBeenCalledWith(expect.stringMatching(new RegExp("^converted-\\d+\\." + selected.ext + "$")), selected.expected, selected.mime);
  if (selected.version === "0.1.4") {
    const warning = "Could not convert without changing the data. Check for duplicate keys, unsupported values, or numbers that cannot be represented exactly.";
    const diagnostic = "Conversion requires unique keys and lossless numbers. 转换要求键唯一，且数值能精确往返。";
    vi.mocked(api.invoke).mockResolvedValueOnce({ result: {
      contractVersion: "1.0.0-rc.1", ok: false, data: null,
      error: { code: "INVALID_INPUT", message: diagnostic },
    } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Execute tool" })); });
    expect(view.getByRole("alert").textContent).toContain(warning);
    expect(view.getByRole("alert").textContent).not.toContain(diagnostic);
    expect(view.queryByRole("button", { name: "Download " + selected.ext.toUpperCase() })).toBeNull();
    const label = selected.op === "to_json" ? /YAML text/ : /JSON text/;
    expect(form.getByRole("textbox", { name: label })).toHaveProperty("value", selected.source.replaceAll("\r\n", "\n"));

    vi.mocked(api.invoke).mockResolvedValueOnce({ result: {
      contractVersion: "1.0.0-rc.1", ok: false, data: null, error: { code: "INVALID_INPUT", message: "Malformed input" },
    } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Execute tool" })); });
    expect(view.getByRole("alert").textContent).not.toContain(warning);
    expect(download).toHaveBeenCalledTimes(1);
  }
});

it("uses the fixed byte limit and recognizes only YAML extensions for YAML input", async () => {
  const exact = "x".repeat(8192);
  for (const name of ["input.yml", "input.YAML"]) {
    await expect(readManualToolFile(file(name, exact) as unknown as File, {}, "yaml-to-json")).resolves.toEqual({ text: exact });
  }
  await expect(readManualToolFile(file("input.yaml", "\uFEFF" + exact) as unknown as File, {}, "yaml-to-json")).rejects.toThrow("8 KiB");
  await expect(readManualToolFile(file("input.json", exact) as unknown as File, {}, "yaml-to-json")).rejects.toThrow("Choose a YAML file.");
});
