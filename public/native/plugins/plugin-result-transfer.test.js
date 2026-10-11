import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createPluginResultTransfer } from "./plugin-result-transfer.js";

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
    expect(gateway.searchTargets).toHaveBeenCalledWith(source.scope, "result", "", 20, "r"),
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
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "encode", 20, "r"));
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text"));
  click("field text");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Change receiver"));
  const oldConfirm = [...document.querySelectorAll("button")].find(node => node.textContent === "Confirm transfer and run");
  click("Change receiver");
  await vi.waitFor(() => expect(gateway.searchTargets).toHaveBeenLastCalledWith(source.scope, "result", "encode", 20, "r"));
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

it("offers receiver reselection after preview rejection and blocks it after scope change", async () => {
  const { gateway, switchTarget } = setup("en");
  gateway.prepareTransfer.mockRejectedValue(new Error("target_changed"));
  await vi.waitFor(() => expect(document.body.textContent).toContain("field text")); click("field text");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Change receiver"));
  switchTarget(); click("Change receiver"); expect(gateway.searchTargets).toHaveBeenCalledTimes(1);
  expect(gateway.commitTransfer).not.toHaveBeenCalled();
});
