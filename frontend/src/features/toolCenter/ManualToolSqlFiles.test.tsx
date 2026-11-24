import { File as NodeFile } from "node:buffer";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

const tool: ManualTool = {
  toolId: "sql-format", accessId: "sql-format", pluginId: "com.zicode.devtools.text",
  capabilityId: "devtools.text.sql.format", title: "SQL Formatter", applicationName: "ZiDevTools Text",
  publisher: "ZiDevTools", version: "0.4.1", enabled: true, runtime: "wasi",
};
const schema = { type: "object", properties: { text: { type: "string", maxLength: 8192 } },
  required: ["text"], additionalProperties: false };

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
    [tool, { ...schema, properties: { text: { type: "string", maxLength: 4096 } } }],
  ] as const) {
    const { form, view } = await open(selected, input);
    expect(form.queryByLabelText("SQL file", { exact: true })).toBeNull();
    view.unmount();
  }
  const { form } = await open({ ...tool, enabled: false });
  expect(form.queryByLabelText("SQL file", { exact: true })).toBeNull();
});
