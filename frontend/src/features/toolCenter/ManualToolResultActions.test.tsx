import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolResultActions } from "./ManualToolResultActions";
import { webcrypto, createHash } from "node:crypto";
import { emptyAccess } from "../commandPalette/tool-access";
import type { CapturedToolResponse } from "../../../../public/native/plugins/plugin-result-actions.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const scope = { sceneId: "programming", workspaceId: "workspace", pluginId: "source", capabilityId: "decode" };
async function mount() {
  setLocale("en");
  vi.stubGlobal("crypto", webcrypto);
  const store = { read: vi.fn(async () => emptyAccess()), mutate: vi.fn(async () => emptyAccess()) };
  const recentChanged = vi.fn();
  const gateway = {
    prepareSave: vi.fn(async () => ({ grantId: "save-grant", preview: { title: "QA", text: "a+b 中", byteLength: 7, packageVersion: "1", workspaceId: "workspace" } })),
    commitSave: vi.fn(async () => ({})),
    searchTargets: vi.fn(async () => ({ revision: "catalog", total: 1, nextOffset: null,
      items: [{ title: "Encode", pluginId: "target", capabilityId: "encode", field: "text" }] })),
    prepareTransfer: vi.fn(async () => ({ grantId: "transfer-grant", preview: { text: "a+b 中", field: "text", inputs: {}, byteLength: 7,
      workspaceId: "workspace", target: { pluginId: "target", packageVersion: "1" } } })),
    commitTransfer: vi.fn(async (): Promise<CapturedToolResponse> => ({ result: { ok: true, data: { text: "encoded" } }, resultRef: { resultId: "receiver-result" }, replayed: false })),
  };
  const busy = vi.fn();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const render = async (resultId: string, workspaceId = "workspace") => { await act(async () => root.render(
    <ManualToolResultActions response={{ result: {}, resultRef: { resultId } }} scope={{ ...scope, workspaceId }} gateway={gateway} onBusy={busy} accessStore={store} onRecentChange={recentChanged} />)); };
  await render("source-result");
  const click = async (text: string) => { await act(async () => {
    const button = [...container.querySelectorAll("button")].find(node => node.textContent === text);
    if (!button) throw new Error(`Missing button: ${text}`);
    button.click();
  }); };
  return { container, gateway, busy, click, render, store, recentChanged };
}

it("previews and cancels without writing; only confirmation uses the Host grant", async () => {
  const { container, gateway, busy, click } = await mount();
  await click("Preview save"); expect(gateway.commitSave).not.toHaveBeenCalled();
  expect(container.querySelector("pre")?.textContent).toBe("a+b 中");
  await click("Cancel save"); expect(gateway.commitSave).not.toHaveBeenCalled();
  await click("Preview save"); await click("Confirm save");
  expect(gateway.commitSave).toHaveBeenCalledWith(scope, "save-grant");
  expect(busy.mock.calls).toEqual([[true], [false]]);
  expect(container.textContent).toContain("Saved to the current workspace artifacts.");
});

it("searches compatible receivers and executes only after confirming the field mapping", async () => {
  const { container, gateway, busy, click, store, recentChanged } = await mount();
  await click("Send to tool");
  expect(gateway.searchTargets).toHaveBeenCalledWith(scope, "source-result", "", 0, null);
  await click("Encode · target · field text");
  expect(gateway.prepareTransfer).toHaveBeenCalledWith(scope, "source-result", { pluginId: "target", capabilityId: "encode" }, "text", {});
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
  expect(store.mutate).not.toHaveBeenCalled();
  await click("Confirm transfer and run");
  expect(gateway.commitTransfer).toHaveBeenCalledWith(scope, "transfer-grant");
  expect(container.querySelector('[aria-label="Transferred result"]')?.textContent).toBe("encoded");
  expect(busy.mock.calls).toEqual([[true], [false]]);
  await vi.waitFor(() => expect(store.mutate).toHaveBeenCalledWith({ sceneId: "programming", workspaceId: "workspace" },
    { kind: "recentRecord", id: `manual.tool:${createHash("sha256").update(JSON.stringify(["target", "encode"])).digest("hex")}` }));
  expect(recentChanged).toHaveBeenCalledTimes(1);
  await click("Preview save");
  expect(gateway.prepareSave).toHaveBeenLastCalledWith({ ...scope, pluginId: "target", capabilityId: "encode" }, "receiver-result", "encode result");
});

it("does not record cancellation, business failure or replayed grant responses", async () => {
  const { gateway, click, store } = await mount();
  await click("Send to tool"); await click("Encode · target · field text"); await click("Cancel transfer");
  expect(store.mutate).not.toHaveBeenCalled();
  await click("Send to tool"); await click("Encode · target · field text");
  gateway.commitTransfer.mockResolvedValueOnce({ result: { ok: false, data: { text: "" } }, resultRef: { resultId: "ignored" }, replayed: false });
  await click("Confirm transfer and run");
  expect(store.mutate).not.toHaveBeenCalled();
  await click("Cancel transfer"); await click("Send to tool"); await click("Encode · target · field text");
  gateway.commitTransfer.mockResolvedValueOnce({ result: { ok: true, data: { text: "cached" } }, resultRef: { resultId: "cached" }, replayed: true });
  await click("Confirm transfer and run");
  expect(store.mutate).not.toHaveBeenCalled();
});

it("keeps a successful receiver result when history fails and never offers a computation retry", async () => {
  const { container, gateway, click, store } = await mount();
  store.mutate.mockRejectedValueOnce(new Error("storage unavailable"));
  await click("Send to tool"); await click("Encode · target · field text"); await click("Confirm transfer and run");
  await vi.waitFor(() => expect(container.textContent).toContain("Tool completed, but history could not be saved."));
  expect(container.querySelector('[aria-label="Transferred result"]')?.textContent).toBe("encoded");
  expect(container.textContent).not.toContain("Transfer failed");
  expect(container.textContent).not.toContain("Confirm transfer and run");
  expect(gateway.commitTransfer).toHaveBeenCalledTimes(1);
});

it("discards a late receiver response after a workspace switch", async () => {
  const { gateway, click, render, store } = await mount();
  let resolve!: (value: Awaited<ReturnType<typeof gateway.commitTransfer>>) => void;
  gateway.commitTransfer.mockImplementation(() => new Promise(done => { resolve = done; }));
  await click("Send to tool"); await click("Encode · target · field text"); await click("Confirm transfer and run");
  await render("other", "another-workspace");
  await act(async () => resolve({ result: { ok: true, data: { text: "stale" } }, resultRef: { resultId: "stale" }, replayed: false }));
  expect(store.mutate).not.toHaveBeenCalled();
});

it("records successful execution even when its result cannot be captured", async () => {
  const { gateway, click, store, container } = await mount();
  gateway.commitTransfer.mockResolvedValueOnce({ result: { ok: true, data: { text: "done" } }, resultCaptureError: { code: "result_profile_unsupported" } });
  await click("Send to tool"); await click("Encode · target · field text"); await click("Confirm transfer and run");
  await vi.waitFor(() => expect(store.mutate).toHaveBeenCalledTimes(1));
  expect(container.textContent).toContain("result_profile_unsupported");
});

it("records the receiver of each confirmed hop, not the original source", async () => {
  const { gateway, click, store } = await mount();
  await click("Send to tool"); await click("Encode · target · field text"); await click("Confirm transfer and run");
  await vi.waitFor(() => expect(store.mutate).toHaveBeenCalledTimes(1));
  gateway.searchTargets.mockResolvedValueOnce({ revision: "next", total: 1, nextOffset: null,
    items: [{ title: "Next", pluginId: "third", capabilityId: "next", field: "text" }] });
  await click("Send to tool"); await click("Next · third · field text"); await click("Confirm transfer and run");
  await vi.waitFor(() => expect(store.mutate).toHaveBeenCalledTimes(2));
  expect(store.mutate).toHaveBeenLastCalledWith({ sceneId: "programming", workspaceId: "workspace" },
    { kind: "recentRecord", id: `manual.tool:${createHash("sha256").update(JSON.stringify(["third", "next"])).digest("hex")}` });
});

it("discards late previews when a new result or workspace replaces the source", async () => {
  const { container, gateway, click, render } = await mount();
  let resolve!: (value: Awaited<ReturnType<typeof gateway.prepareSave>>) => void;
  gateway.prepareSave.mockImplementation(() => new Promise(done => { resolve = done; }));
  await click("Preview save");
  await render("new-result", "other-workspace");
  await act(async () => resolve({ grantId: "stale", preview: { title: "stale", text: "stale", byteLength: 5, packageVersion: "1", workspaceId: "workspace" } }));
  expect(container.textContent).not.toContain("stale");
  expect(gateway.commitSave).not.toHaveBeenCalled();
});
