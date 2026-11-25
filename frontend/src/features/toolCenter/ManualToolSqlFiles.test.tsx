import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import * as downloads from "../../shared/download-file";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

const tool: ManualTool = {
  toolId: "sql-format", accessId: "sql-format", pluginId: "com.zicode.devtools.text",
  capabilityId: "devtools.text.sql.format", title: "SQL Formatter", applicationName: "ZiDevTools Text",
  publisher: "ZiDevTools", version: "0.4.1", enabled: true, runtime: "wasi",
};
const schema = { type: "object", properties: { text: { type: "string", maxLength: 8192 } },
  required: ["text"], additionalProperties: false };
const newTool = { ...tool, version: "0.4.2" };
const optionSchema = {
  ...schema,
  properties: {
    ...schema.properties,
    dialect: { type: "string", title: "SQL dialect", enum: ["generic", "postgresql", "mysql", "sqlite", "sqlserver"], default: "generic" },
    indent: { type: "string", title: "Indentation", enum: ["twoSpaces", "fourSpaces", "tabs"], default: "fourSpaces" },
    keywordCase: { type: "string", title: "Keyword case", enum: ["uppercase", "lowercase", "preserve"], default: "uppercase" },
  },
};

afterEach(cleanup);

async function open(selected: ManualTool = tool, inputSchema = schema) {
  setLocale("en");
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({ pluginId: selected.pluginId, version: selected.version, revision: "sql-revision",
      enabled: selected.enabled, permissions: [], capability: { id: selected.capabilityId, inputSchema } })),
    invoke: vi.fn(async () => ({ result: "formatted" })),
  };
  const view = render(<ManualToolDetail tool={selected} revision="sql-revision"
    scope={{ sceneId: "programming", workspaceId: "isolated" }} api={api} />);
  const form = within(await view.findByRole("form", { name: "Tool inputs" }));
  const pick = async (...files: (NodeFile | { name: string; size: number; slice(): never })[]) => {
    await act(async () => {
      fireEvent.change(form.getByLabelText("SQL file", { exact: true }), { target: { files } });
    });
  };
  return { view, api, form, pick };
}

const file = (name: string, content: string | Uint8Array<ArrayBuffer>) => new NodeFile([content], name);

it("imports the source, handles BOM and undo, then submits the exact UTF-8 draft only on request", async () => {
  const { api, form, pick } = await open();
  const editor = form.getByRole<HTMLTextAreaElement>("textbox", { name: /SQL text/ });
  expect(form.getByLabelText<HTMLInputElement>("SQL file", { exact: true }).accept).toBe(".sql");
  fireEvent.change(editor, { target: { value: "select 'previous source';" } });
  const source = "-- 原文\r\nselect '你好; literal' as text from synthetic;\r\n  ";
  const selected = file("example.SQL", "\uFEFF" + source);
  await pick(selected);
  expect(editor.value).toBe(source.replaceAll("\r\n", "\n"));
  await pick();
  fireEvent.change(editor);
  expect(api.invoke).not.toHaveBeenCalled();
  fireEvent.click(form.getByRole("button", { name: "Undo last import" }));
  expect(editor.value).toBe("select 'previous source';");
  await pick(selected);
  await act(async () => { fireEvent.click(form.getByRole("button", { name: "Execute tool" })); });
  expect(vi.mocked(api.invoke)).toHaveBeenCalledOnce();
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: source });
  expect(Buffer.from(await selected.arrayBuffer())).toEqual(Buffer.from("\uFEFF" + source));
});

it("leaves the current draft available on invalid files and accepts the exact byte boundary", async () => {
  const { api, form, pick, view } = await open();
  const editor = form.getByRole<HTMLTextAreaElement>("textbox", { name: /SQL text/ });
  const boundary = "-- " + "界".repeat(2729) + "xy";
  expect(Buffer.byteLength(boundary)).toBe(8192);
  await pick(file("exact.sql", boundary));
  expect(editor.value).toBe(boundary);
  const unreadable = { name: "unreadable.sql", size: 3, slice: () => { throw Error("synthetic read failure"); } };
  for (const [selected, message] of [
    [file("invalid.sql", new Uint8Array([0xff])), "valid UTF-8"],
    [file("empty.sql", " \r\n"), "SQL file is empty"],
    [file("oversized.sql", boundary + "!"), "8 KiB"],
    [file("other.txt", "select 1"), "Choose a SQL file."],
    [unreadable, "Could not read the SQL file."],
  ] as const) {
    await pick(selected);
    expect(view.getByRole("alert").textContent).toContain(message);
    expect(editor.value).toBe(boundary);
  }
  expect(api.invoke).not.toHaveBeenCalled();
});

it("only exposes SQL file import for the existing enabled compatible formatter", async () => {
  for (const [selected, input] of [
    [{ ...tool, capabilityId: "devtools.text.base64.encode" }, schema],
    [{ ...tool, version: "0.4.0" }, schema],
    [{ ...tool, version: "0.4.3" }, optionSchema],
    [tool, { ...schema, properties: { text: { type: "string", maxLength: 4096 } } }],
  ] as const) {
    const { form, view } = await open(selected, input);
    expect(form.queryByLabelText("SQL file", { exact: true })).toBeNull();
    view.unmount();
  }
  const { form } = await open({ ...tool, enabled: false });
  expect(form.queryByLabelText("SQL file", { exact: true })).toBeNull();
});

it("keeps the new options when importing or undoing SQL and clears a result after changing an option", async () => {
  const { api, form, pick, view } = await open(newTool, optionSchema);
  const editor = form.getByRole("textbox", { name: /SQL text/ });
  const submit = async () => { await act(async () => { fireEvent.click(form.getByRole("button", { name: "Execute tool" })); }); };
  const choose = (label: string, choice: string) => {
    const input = form.getByRole<HTMLSelectElement>("combobox", { name: label });
    const option = within(input).getByRole<HTMLOptionElement>("option", { name: choice });
    fireEvent.change(input, { target: { value: option.value } });
  };
  const source = "select $tag$原文;$tag$;";
  fireEvent.change(editor, { target: { value: "select 0;" } });
  await submit();
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: "select 0;" });

  choose("SQL dialect", "PostgreSQL");
  choose("Indentation", "2 spaces");
  choose("Keyword case", "Lowercase");
  await pick(file("input.sql", source));
  fireEvent.click(form.getByRole("button", { name: "Undo last import" }));
  expect((editor as HTMLTextAreaElement).value).toBe("select 0;");
  await pick(file("input.sql", source));
  expect(api.invoke).toHaveBeenCalledTimes(1);

  vi.mocked(api.invoke).mockResolvedValueOnce({
    result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: source }, error: null },
  });
  await submit();
  expect(vi.mocked(api.invoke).mock.calls[1][4]).toEqual({
    text: source, dialect: "postgresql", indent: "twoSpaces", keywordCase: "lowercase",
  });
  expect(view.getByRole("button", { name: "Download formatted SQL" })).toBeTruthy();
  choose("Keyword case", "Keep original case");
  expect(view.queryByRole("button", { name: "Download formatted SQL" })).toBeNull();
  expect(api.invoke).toHaveBeenCalledTimes(2);
});

it("downloads only a fresh successful SQL response as a separate file", async () => {
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  try {
    const { api, form, view } = await open();
    const label = "Download formatted SQL";
    const editor = form.getByRole("textbox", { name: /SQL text/ });
    const execute = form.getByRole("button", { name: "Execute tool" });
    const output = "-- 格式化\r\nSELECT '保留' AS example;\n";
    const success = { contractVersion: "1.0.0-rc.1", ok: true, data: { text: output }, error: null };
    fireEvent.change(editor, { target: { value: "select '保留' as example;" } });
    expect(view.queryByRole("button", { name: label })).toBeNull();
    vi.mocked(api.invoke).mockResolvedValueOnce({ result: success });
    await act(async () => { fireEvent.click(execute); });
    expect(download).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: label }));
    expect(download).toHaveBeenCalledWith(expect.stringMatching(/^formatted-sql-\d+\.sql$/), output, "application/sql");

    fireEvent.change(editor, { target: { value: "select 'new';" } });
    expect(view.queryByRole("button", { name: label })).toBeNull();
    for (const result of [output, { ...success, error: { code: "unexpected" } }, { ...success, data: { text: "" } }]) {
      vi.mocked(api.invoke).mockResolvedValueOnce({ result });
      await act(async () => { fireEvent.click(execute); });
      expect(view.queryByRole("button", { name: label })).toBeNull();
    }

    vi.mocked(api.invoke).mockResolvedValueOnce({ result: success });
    await act(async () => { fireEvent.click(execute); });
    expect(view.queryByRole("button", { name: label })).not.toBeNull();
    vi.mocked(api.invoke).mockRejectedValueOnce({ code: "worker_cancelled" });
    await act(async () => { fireEvent.click(execute); });
    expect(view.queryByRole("button", { name: label })).toBeNull();
    vi.mocked(api.invoke).mockResolvedValueOnce({ result: success });
    await act(async () => { fireEvent.click(execute); });
    view.getByRole("button", { name: label });
    for (const workspaceId of ["another-workspace", "isolated"]) {
      view.rerender(<ManualToolDetail tool={tool} revision="sql-revision"
        scope={{ sceneId: "programming", workspaceId }} api={api} />);
      expect(view.queryByRole("button", { name: label })).toBeNull();
    }
    expect(download).toHaveBeenCalledTimes(1);
  } finally { download.mockRestore(); }
});
