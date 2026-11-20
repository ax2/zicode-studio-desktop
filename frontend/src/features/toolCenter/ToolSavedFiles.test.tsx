import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ToolCenterApp } from "./ToolCenterApp";
import type { SavedOutput, SavedOutputPage } from "../artifacts/saved-output-types";

const id = "12345678-1234-4234-8234-123456789abc";
const item: SavedOutput = { receiptVersion: "a".repeat(64), integrity: "not_checked", receipt: {
  schemaVersion: 1, profile: "resource.save.draft1", saveId: id, workspaceId: "ws", relativePath: `.zicode/outputs/${id}/result.txt`, mimeType: "text/plain", byteLength: 5,
  contentVersion: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", preparedAt: "2026-10-26T00:00:00Z", source: { pluginId: "fixture", capabilityId: "text", resourceId: id, packageVersion: "1.0.0" } } };
const page: SavedOutputPage = { schemaVersion: 1, profile: "resource.library.draft1", workspaceId: "ws", pageSize: 40, offset: 0, total: 1, hasMore: false, skippedEntries: 0, payloadsRead: false, items: [item] };
const descriptors = { showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close") };
beforeEach(() => {
  setLocale("en"); vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setLocale("zh-CN"); delete document.body.dataset.activePlugin;
  for (const name of ["showModal", "close"] as const) { const d = descriptors[name]; if (d) Object.defineProperty(HTMLDialogElement.prototype, name, d); else Reflect.deleteProperty(HTMLDialogElement.prototype, name); }
});
function fixture() {
  const savedOutputs = { list: vi.fn(async () => page), read: vi.fn(async (_scene: string, _workspace: string, _item: SavedOutput, _signal?: AbortSignal) => new TextEncoder().encode("hello").buffer) };
  const tool = { toolId: "fixture-tool", accessId: "fixture-access", pluginId: "fixture", capabilityId: "text", title: "Text fixture", applicationName: "Fixture", publisher: "Fixture", version: "1.0.0", enabled: true, runtime: "wasi" };
  const api = { savedOutputs, searchTools: vi.fn(async () => ({ items: [tool], total: 1, revision: "rev", nextOffset: null })),
    loadTool: vi.fn(async () => ({ pluginId: "fixture", version: "1.0.0", revision: "rev", enabled: true, capability: { id: "text", inputSchema: { type: "object", properties: { text: { type: "string", title: "Draft text", maxLength: 8192 } }, required: ["text"] } }, permissions: [] })), invoke: vi.fn() };
  const props = { entries: [], toolApi: api, scope: { sceneId: "programming", workspaceId: "ws" }, requestedTool: { tool, revision: "rev" }, onOpen: vi.fn(), onManage: vi.fn(), onCommands: vi.fn() };
  const view = render(<ToolCenterApp {...props} />);
  const open = async () => { fireEvent.click(screen.getByRole("button", { name: "Saved files" })); return screen.findByRole("dialog", { name: "Saved tool files" }); };
  return { savedOutputs, api, props, view, open };
}
it("opens saved files directly, reads only on request and retains the current tool draft", async () => {
  const f = fixture(); const input = await screen.findByLabelText(/Draft text/); fireEvent.change(input, { target: { value: "keep this draft" } });
  expect(f.savedOutputs.list).not.toHaveBeenCalled(); await f.open(); await screen.findByText("fixture · text"); expect(f.savedOutputs.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Preview saved file" })); await screen.findByDisplayValue("hello");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.getByDisplayValue("keep this draft")).toBe(input);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Saved files" })); expect(f.api.invoke).not.toHaveBeenCalled();
});
it("discards a pending read after Escape without a late preview or download", async () => {
  const f = fixture(); await f.open(); await screen.findByText("fixture · text"); let finish!: (bytes: ArrayBuffer) => void;
  f.savedOutputs.read.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Download saved file" })); await waitFor(() => expect(finish).toBeTypeOf("function"));
  const signal = f.savedOutputs.read.mock.calls[0][3];
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true })); expect(signal?.aborted).toBe(true);
  finish(new TextEncoder().encode("hello").buffer); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(download).not.toHaveBeenCalled();
});
it("closes on a workspace or application switch without carrying old files across scope", async () => {
  const f = fixture(); await f.open(); await screen.findByText("fixture · text");
  f.view.rerender(<ToolCenterApp {...f.props} scope={{ ...f.props.scope, workspaceId: "other" }} />);
  expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.queryByText("fixture · text")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Saved files" }));
  document.body.dataset.activePlugin = "core.chat"; document.dispatchEvent(new CustomEvent("zicode:active-plugin-changed"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("keeps failed listing recoverable through explicit search", async () => {
  const f = fixture(); f.savedOutputs.list.mockRejectedValueOnce(new Error("private path")); await f.open();
  await screen.findByText(/Saved files could not be loaded/); expect(document.body.textContent).not.toContain("private path");
  fireEvent.click(screen.getByRole("button", { name: "Search" })); await screen.findByText("fixture · text"); expect(f.savedOutputs.read).not.toHaveBeenCalled();
});
it("omits the entry if the saved file gateway is unavailable", () => {
  render(<ToolCenterApp entries={[]} onOpen={vi.fn()} onManage={vi.fn()} onCommands={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Saved files" })).toBeNull();
});
