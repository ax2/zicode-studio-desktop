import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createPluginResultTransfer } from "./plugin-result-transfer.js";
import { toolCategoryTitle } from "./tool-category-title.js";

const source = {
  scope: {
    sceneId: "programming",
    workspaceId: "workspace",
    pluginId: "source",
    capabilityId: "format",
  },
  resultId: "result",
};
const target = { pluginId: "receiver", capabilityId: "encode", title: "编码", field: "text" };
function setup(locale = "zh-CN") {
  setLocale(locale);
  document.body.replaceChildren();
  let current = true;
  const gateway = {
    searchTargets: vi.fn(async () => ({
      items: [target],
      total: 1,
      revision: "r",
      nextOffset: null,
    })),
    prepareTransfer: vi.fn(async () => ({
      grantId: "grant",
      preview: {
        text: "<unsafe>",
        target: { pluginId: "receiver", packageVersion: "1" },
        field: "text",
        byteLength: 8,
        workspaceId: "workspace",
      },
    })),
    commitTransfer: vi.fn(async () => ({
      result: { ok: true, data: { text: "encoded" } },
      resultRef: { resultId: "next" },
    })),
    cancelTransfer: vi.fn(async () => ({ schemaVersion: 1, status: "cancellation_requested" })),
    transferStatus: vi.fn(async () => ({ schemaVersion: 1, status: "ready" })),
  };
  const onCancel = vi.fn();
  const onResult = vi.fn();
  const controller = createPluginResultTransfer({
    panel: document.body,
    gateway,
    source,
    isCurrent: () => current,
    onCancel,
    onResult,
  });
  return {
    gateway,
    controller,
    onCancel,
    onResult,
    switchTarget: () => {
      current = false;
    },
  };
}
const click = (text) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent.includes(text)).click();
afterEach(() => document.body.replaceChildren());

it("collects the other required text field and previews it before a separate confirmation", async () => {
  const { gateway } = setup("en");
  gateway.searchTargets.mockResolvedValue({ items: [{ ...target, field: "left", requiredInputs: ["right"] }], total: 1, revision: "r", nextOffset: null });
  click("Search tools");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field left"));
  click("field left");
  expect(gateway.prepareTransfer).not.toHaveBeenCalled();
  document.querySelector('textarea[aria-label="right"]').value = "<other>\nvalue";
  gateway.prepareTransfer.mockResolvedValue({ grantId: "grant", preview: { text: "source", field: "left", inputs: { right: "<other>\nvalue" }, target: { pluginId: "receiver", packageVersion: "1" } } });
  click("Preview all inputs");
  await vi.waitFor(() => expect(document.body.textContent).toContain("<other>\nvalue"));
  expect(gateway.prepareTransfer).toHaveBeenCalledWith(source.scope, "result", { pluginId: "receiver", capabilityId: "encode" }, "left", { right: "<other>\nvalue" });
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
  expect(document.querySelector("other")).toBeNull();
  click("Cancel transfer");
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
});

it("uses English controls and status when the workspace language is English", async () => {
  setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Compatible mappings: 1"));
  expect(document.querySelector('input[aria-label="Search receiver tools"]')).toBeTruthy();
  expect(document.body.textContent).toContain("Cancel transfer");
});

it("allows correcting additional inputs after Host rejection without executing", async () => {
  const { gateway } = setup("en");
  gateway.searchTargets.mockResolvedValue({ items: [{ ...target, field: "left", requiredInputs: ["right"] }], total: 1, revision: "r", nextOffset: null });
  click("Search tools");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field left"));
  click("field left");
  document.querySelector("textarea").value = "keep this draft";
  gateway.prepareTransfer.mockRejectedValue(new Error("invalid_parameters"));
  click("Preview all inputs");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Edit receiver inputs"));
  click("Edit receiver inputs");
  expect(document.querySelector("textarea").value).toBe("keep this draft");
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
});

it("requires explicit confirmation and returns the new result with target scope", async () => {
  const { gateway, onResult } = setup();
  await vi.waitFor(() => expect(document.body.textContent).toContain("编码"));
  click("编码");
  await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  expect(document.querySelector("pre").textContent).toBe("<unsafe>");
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
  click("确认发送并执行");
  await vi.waitFor(() =>
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ resultRef: { resultId: "next" } }),
      { ...source.scope, pluginId: "receiver", capabilityId: "encode" },
    ),
  );
});

it("cancel and workspace change prevent confirmation and late previews", async () => {
  const { gateway, switchTarget, onCancel } = setup();
  await vi.waitFor(() => expect(document.body.textContent).toContain("编码"));
  let resolve;
  gateway.prepareTransfer.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  click("编码");
  click("取消发送");
  resolve({ preview: { text: "late" } });
  await Promise.resolve();
  expect(document.querySelector("pre")).toBeNull();
  expect(onCancel).toHaveBeenCalledOnce();
  switchTarget();
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
});

it("keeps pages bounded and rejects business failure as a new successful result", async () => {
  const { gateway, onResult } = setup();
  gateway.searchTargets.mockResolvedValue({
    items: [target],
    total: 50,
    revision: "r",
    nextOffset: 20,
  });
  click("搜索工具");
  await vi.waitFor(() => expect(document.body.textContent).toContain("下一页工具"));
  click("下一页工具");
  await vi.waitFor(() =>
    expect(gateway.searchTargets).toHaveBeenCalledWith(source.scope, "result", "", 20, "r", expect.objectContaining({ signal: expect.any(AbortSignal) })),
  );
  click("编码");
  await vi.waitFor(() => expect(document.querySelector("pre")).toBeTruthy());
  gateway.commitTransfer.mockResolvedValue({
    result: { ok: false, error: { code: "INVALID_ENCODING" } },
  });
  click("确认发送并执行");
  await vi.waitFor(() => expect(document.body.textContent).toContain("INVALID_ENCODING"));
  expect(onResult).not.toHaveBeenCalled();
});

it("returns to the same search page without executing and invalidates the old confirmation", async () => {
  const { gateway } = setup("en");
  gateway.searchTargets.mockResolvedValue({ items: [target], total: 45, revision: "r", nextOffset: 20 });
  const search = document.querySelector('input[type="search"]'); search.value = "encode";
  click("Search tools");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Next tool page"));
  click("Next tool page");
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "encode", 20, "r", expect.objectContaining({ signal: expect.any(AbortSignal) })));
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  click("field text");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Change receiver"));
  const oldConfirm = [...document.querySelectorAll("button")].find(node => node.textContent === "Confirm transfer and run");
  click("Change receiver");
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "encode", 20, "r", expect.objectContaining({ signal: expect.any(AbortSignal) })));
  expect(document.querySelector('input[type="search"]').value).toBe("encode");
  expect(document.activeElement).toBe(document.querySelector('input[type="search"]'));
  oldConfirm.click(); expect(gateway.commitTransfer).not.toHaveBeenCalled();
});

it("edits previewed additional inputs without losing the draft or reusing the old grant", async () => {
  const { gateway } = setup("en");
  gateway.searchTargets.mockResolvedValue({ items: [{ ...target, requiredInputs: ["right"] }], total: 1, revision: "r", nextOffset: null });
  click("Search tools"); await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  click("field text"); expect(document.body.textContent).toContain("编码 · receiver · field text");
  document.querySelector("textarea").value = "draft one"; click("Preview all inputs");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Edit receiver inputs"));
  const oldConfirm = [...document.querySelectorAll("button")].find(node => node.textContent === "Confirm transfer and run");
  click("Edit receiver inputs"); expect(document.querySelector("textarea").value).toBe("draft one");
  oldConfirm.click(); expect(gateway.commitTransfer).not.toHaveBeenCalled();
  document.querySelector("textarea").value = "draft two"; click("Preview all inputs");
  await vi.waitFor(() => expect(gateway.prepareTransfer).toHaveBeenLastCalledWith(source.scope, "result", { pluginId: "receiver", capabilityId: "encode" }, "text", { right: "draft two" }));
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
});

it("returns from additional inputs without copying drafts to another receiver or accepting stale forms", async () => {
  const { gateway } = setup("en");
  gateway.searchTargets.mockResolvedValue({ items: [{ ...target, requiredInputs: ["right"] }], total: 1, revision: "r", nextOffset: null });
  click("Search tools"); await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  click("field text"); const oldForm = document.querySelector("form");
  document.querySelector("textarea").value = "private draft"; click("Change receiver");
  oldForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(gateway.prepareTransfer).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text")); click("field text");
  expect(document.querySelector("textarea").value).toBe("");
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
});

it("locks receiver and input editing during confirmed computation", async () => {
  const { gateway, onResult } = setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text")); click("field text");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Change receiver"));
  let finish; gateway.commitTransfer.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  click("Confirm transfer and run");
  const change = [...document.querySelectorAll("button")].find(node => node.textContent === "Change receiver");
  expect(change.disabled).toBe(true); change.click(); expect(gateway.searchTargets).toHaveBeenCalledTimes(1);
  finish({ result: { ok: false, error: { code: "BUSINESS" } } });
  await vi.waitFor(() => expect(change.disabled).toBe(false)); expect(onResult).not.toHaveBeenCalled();
  click("Change receiver"); await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenCalledTimes(2));
  expect(gateway.commitTransfer).toHaveBeenCalledTimes(1);
});

it("requests Host cancellation during confirmed computation and waits for the final outcome", async () => {
  const { gateway, onResult } = setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  click("field text");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Change receiver"));
  let finish;
  gateway.commitTransfer.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  click("Confirm transfer and run");
  click("Cancel transfer");
  await vi.waitFor(() => expect(gateway.cancelTransfer).toHaveBeenCalledWith(source.scope, "grant"));
  expect(document.body.textContent).toContain("waiting for the receiver outcome");
  expect(onResult).not.toHaveBeenCalled();
  finish({ error: { code: "worker_cancelled" } });
  await vi.waitFor(() => expect(document.body.textContent).toContain("Receiver tool cancelled"));
  expect(onResult).not.toHaveBeenCalled();
});

it("shows a successful receiver result if completion wins the cancellation race", async () => {
  const { gateway, onResult } = setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  click("field text");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Change receiver"));
  let finish;
  gateway.commitTransfer.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  gateway.cancelTransfer.mockResolvedValue({ schemaVersion: 1, status: "completed" });
  click("Confirm transfer and run");
  click("Cancel transfer");
  await vi.waitFor(() => expect(gateway.cancelTransfer).toHaveBeenCalledOnce());
  finish({ result: { ok: true, data: { text: "completed" } }, resultRef: { resultId: "next" } });
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
});

it("recovers a completed receiver result after the commit connection fails without repeating execution", async () => {
  const { gateway, onResult } = setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  click("field text");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Change receiver"));
  gateway.commitTransfer.mockRejectedValueOnce(new Error("connection lost"));
  gateway.transferStatus.mockResolvedValueOnce({ schemaVersion: 1, status: "completed",
    response: { result: { ok: true, data: { text: "recovered" } }, resultRef: { resultId: "next" } } });
  click("Confirm transfer and run");
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
  expect(onResult.mock.calls[0][0].result.data.text).toBe("recovered");
  expect(gateway.commitTransfer).toHaveBeenCalledTimes(1);
  expect(gateway.transferStatus).toHaveBeenCalledWith(source.scope, "grant");
});

it("keeps confirmation disabled while a disconnected receiver is running, then recovers by status", async () => {
  const { gateway, onResult } = setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  click("field text");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Change receiver"));
  gateway.commitTransfer.mockRejectedValueOnce(new Error("connection lost"));
  gateway.transferStatus.mockResolvedValueOnce({ schemaVersion: 1, status: "running" })
    .mockResolvedValueOnce({ schemaVersion: 1, status: "completed",
      response: { result: { ok: true, data: { text: "later" } } } });
  click("Confirm transfer and run");
  await vi.waitFor(() => expect(document.body.textContent).toContain("still running"));
  expect([...document.querySelectorAll("button")].find(node => node.textContent === "Confirm transfer and run").disabled).toBe(true);
  click("Check receiver outcome");
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
  expect(gateway.commitTransfer).toHaveBeenCalledTimes(1);
});

it("offers receiver reselection after preview rejection and blocks it after scope change", async () => {
  const { gateway, switchTarget } = setup("en");
  gateway.prepareTransfer.mockRejectedValue(new Error("target_changed"));
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text")); click("field text");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Change receiver"));
  switchTarget(); click("Change receiver"); expect(gateway.searchTargets).toHaveBeenCalledTimes(1);
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
});

it("uses project favorites and recent with access revision pagination, without execution", async () => {
  const { gateway } = setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  gateway.searchTargets.mockResolvedValue({ items: [target], total: 22, revision: "personalized", accessRevision: 7, nextOffset: 20 });
  click("Favorites");
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "", 0, null, expect.objectContaining({ view: "favorites", accessRevision: null, signal: expect.any(AbortSignal) })));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Next tool page"));
  click("Next tool page");
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "", 20, "personalized", expect.objectContaining({ view: "favorites", accessRevision: 7, signal: expect.any(AbortSignal) })));
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  click("Recent");
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "", 0, null, expect.objectContaining({ view: "recent", accessRevision: null, signal: expect.any(AbortSignal) })));
  expect(gateway.prepareTransfer).not.toHaveBeenCalled(); expect(gateway.commitTransfer).not.toHaveBeenCalled();
});

it("filters a large ordinary result receiver directory by source and category before loading inputs", async () => {
  const { gateway } = setup("en");
  gateway.searchTargets.mockResolvedValue({ items: [target], total: 22, revision: "filtered", accessRevision: 7,
    nextOffset: 20, sources: [{ pluginId: "receiver", title: "Receiver tools", count: 22 }],
    categories: [{ id: "text", count: 22 }] });
  click("Search tools");
  await vi.waitFor(() => expect(document.querySelector('select[aria-label="Tool source"] option[value="receiver"]')).toBeTruthy());
  const sourceSelect = document.querySelector('select[aria-label="Tool source"]');
  sourceSelect.value = "receiver"; sourceSelect.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "", 0, null,
    expect.objectContaining({ pluginId: "receiver", signal: expect.any(AbortSignal) })));
  const categorySelect = document.querySelector('select[aria-label="Tool category"]');
  categorySelect.value = "text"; categorySelect.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "", 0, null,
    expect.objectContaining({ pluginId: "receiver", categoryId: "text", signal: expect.any(AbortSignal) })));
  click("Favorites");
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "", 0, null,
    expect.objectContaining({ view: "favorites", pluginId: "receiver", categoryId: "text", accessRevision: null })));
  expect(gateway.prepareTransfer).not.toHaveBeenCalled();
});

it("explains global facet counts and localizes declared category titles", async () => {
  const { gateway } = setup();
  gateway.searchTargets.mockResolvedValue({ items: [target], total: 2, revision: "facets", nextOffset: null,
    sources: [{ pluginId: "receiver", title: "接收工具", count: 2 }],
    categories: [{ id: "uncategorized", count: 7 }, { id: "code", count: 1 }] });
  click("搜索工具");
  await vi.waitFor(() => expect(document.querySelector('select[aria-label="工具分类"] option[value="uncategorized"]')?.textContent).toBe("未分类 · 7"));
  expect(document.querySelector('select[aria-label="工具分类"] option[value="code"]')?.textContent).toBe("编码与调试 · 1");
  expect(document.body.textContent).toContain("筛选项数字统计当前视图的全部兼容字段");
  expect(toolCategoryTitle("provider-custom")).toBe("provider-custom");
  expect(gateway.prepareTransfer).not.toHaveBeenCalled();
});

it("ignores late personalized pages and keeps selected view when changing receiver", async () => {
  const { gateway } = setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  let late; gateway.searchTargets.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  click("Favorites"); click("Recent");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  late({ items: [{ ...target, title: "obsolete favorite" }], total: 1, revision: "late", accessRevision: 1, nextOffset: null });
  await Promise.resolve(); expect(document.body.textContent).not.toContain("obsolete favorite");
  click("field text"); await vi.waitFor(() => expect(document.body.textContent).toContain("Change receiver"));
  click("Change receiver");
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "", 0, "r", expect.objectContaining({ view: "recent", accessRevision: null, signal: expect.any(AbortSignal) })));
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
});

it("requires explicit refresh after access revision conflict without replaying or executing", async () => {
  const { gateway } = setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  gateway.searchTargets.mockRejectedValueOnce(Object.assign(new Error("internal host detail"), { code: "result_target_revision_changed" }));
  click("Favorites");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Search again to refresh"));
  expect(document.body.textContent).not.toContain("internal host detail");
  click("Search tools");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "", 0, null, expect.objectContaining({ view: "favorites", accessRevision: null, signal: expect.any(AbortSignal) }));
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
});

it("aborts superseded and cancelled receiver searches", async () => {
  const { gateway, onCancel } = setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  const signals = [];
  gateway.searchTargets.mockImplementation((_scope, _resultId, _query, _offset, _revision, options) => {
    signals.push(options.signal);
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () =>
      reject(Object.assign(new Error("cancelled"), { code: "plugin_capability_cancelled" })), { once: true }));
  });
  click("Favorites");
  expect(signals[0].aborted).toBe(false);
  click("Recent");
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  click("Cancel transfer");
  expect(signals[1].aborted).toBe(true);
  expect(onCancel).toHaveBeenCalledOnce();
});

it("aborts an in-flight receiver search when its controller is destroyed", async () => {
  const { gateway, controller } = setup("en");
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  let signal;
  gateway.searchTargets.mockImplementation((_scope, _resultId, _query, _offset, _revision, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () =>
      reject(Object.assign(new Error("cancelled"), { code: "plugin_capability_cancelled" })), { once: true }));
  });
  click("Favorites");
  expect(signal.aborted).toBe(false);
  controller.destroy();
  expect(signal.aborted).toBe(true);
});
