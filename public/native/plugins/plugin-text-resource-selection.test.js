import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale, translateDocument } from "../../i18n.js";
import { createTextResourceSelection } from "./plugin-text-resource-selection.js";
import { createResourceInputModes } from "./plugin-resource-input-modes.js";

function setup(mode = false, locale = "en") {
  setLocale(locale); vi.stubGlobal("crypto", webcrypto);
  document.body.innerHTML = "<main></main>";
  const records = new Map(); let next = 0;
  const gateway = {
    prepareResource: vi.fn(async value => {
      const resourceId = `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
      records.set(resourceId, value); return { resourceId };
    }),
    appendResource: vi.fn(async (_access, offset, data) => ({ uploadedBytes: offset + atob(data).length })),
    commitResource: vi.fn(async access => ({ ...access, confirmed: true, byteLength: records.get(access.resourceId).byteLength })),
    revokeResource: vi.fn(async () => ({})),
  };
  const onResource = vi.fn(), current = { value: true };
  const options = { container: document.querySelector("main"), gateway, onResource,
    plugin: { id: "test.plugin", capabilities: [{ id: "test.replace" }] },
    target: { instanceId: "runtime", sessionId: "session" }, isCurrent: () => current.value,
    resourceLabels: ["Input text", "Replacement template"], minResources: 2, maxResources: 2 };
  const files = vi.fn(value => {
    value.container.textContent = "file picker";
    return { destroy: vi.fn(() => value.container.replaceChildren()) };
  });
  const controller = mode ? createResourceInputModes(options, files, ["text/plain"]) : createTextResourceSelection(options);
  const input = (index, value) => {
    const textarea = document.querySelectorAll("textarea")[index];
    textarea.value = value; textarea.dispatchEvent(new Event("input")); return textarea;
  };
  const click = text => [...document.querySelectorAll("button")].find(button => button.textContent === text).click();
  return { gateway, onResource, controller, input, click, current, files, options };
}
afterEach(() => { vi.unstubAllGlobals(); setLocale("zh-CN"); document.body.innerHTML = ""; });

it("keeps pasted Unicode private until confirmation and shares exact ordered bytes", async () => {
  const view = setup();
  view.input(0, "甲-7🙂"); view.input(1, "${name}:$2");
  expect(view.gateway.prepareResource).not.toHaveBeenCalled();
  view.click("Confirm text sharing");
  await vi.waitFor(() => expect(view.onResource.mock.calls.some(([value]) => value?.additionalResources?.length === 1)).toBe(true));
  expect(view.gateway.prepareResource.mock.calls.map(([value]) => [value.mimeType, value.byteLength])).toEqual([["text/plain", 9], ["text/plain", 10]]);
  expect(view.controller.getValues()).toEqual(["甲-7🙂", "${name}:$2"]);
  const bytes = Uint8Array.from(atob(view.gateway.appendResource.mock.calls[0][2]), value => value.charCodeAt(0));
  expect(new TextDecoder().decode(bytes)).toBe("甲-7🙂");
  view.controller.destroy(); expect(view.gateway.revokeResource).toHaveBeenCalledTimes(2);
});

it("allows empty source and template without inventing placeholder bytes", async () => {
  const view = setup(); view.click("Confirm text sharing");
  await vi.waitFor(() => expect(view.gateway.commitResource).toHaveBeenCalledTimes(2));
  expect(view.gateway.prepareResource.mock.calls.map(([value]) => value.byteLength)).toEqual([0, 0]);
  expect(view.gateway.appendResource).not.toHaveBeenCalled(); view.controller.destroy();
});

it("requires reconfirmation after editing and retains text on cancellation", async () => {
  const view = setup(); view.input(0, "source"); view.input(1, "replacement"); view.click("Confirm text sharing");
  await vi.waitFor(() => expect(view.onResource.mock.calls.some(([value]) => value?.additionalResources)).toBe(true));
  view.input(0, "edited");
  expect(view.gateway.revokeResource).toHaveBeenCalledTimes(2);
  expect(view.onResource).toHaveBeenLastCalledWith(null);
  expect(view.gateway.prepareResource).toHaveBeenCalledTimes(2);
  view.click("Cancel text sharing"); expect(view.controller.getValues()).toEqual(["edited", "replacement"]); view.controller.destroy();
});

it("releases a partially shared group and keeps both inputs after a failure", async () => {
  const view = setup(); view.input(0, "source"); view.input(1, "template");
  view.gateway.commitResource.mockRejectedValueOnce(new Error("not-confirmed"));
  view.click("Confirm text sharing");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Could not share text"));
  expect(view.gateway.revokeResource).toHaveBeenCalledOnce();
  expect(view.onResource.mock.calls.every(([value]) => value === null)).toBe(true);
  expect(view.controller.getValues()).toEqual(["source", "template"]); view.controller.destroy();
});

it("cancels sharing in flight and never delivers a stale grant", async () => {
  const view = setup(); let resolve;
  view.gateway.prepareResource.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  view.input(0, "kept"); view.click("Confirm text sharing");
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  view.click("Cancel text sharing"); resolve({ resourceId: "00000000-0000-4000-8000-000000000001" });
  await vi.waitFor(() => expect(view.gateway.revokeResource).toHaveBeenCalledOnce());
  expect(view.gateway.commitResource).not.toHaveBeenCalled();
  expect(view.onResource.mock.calls.every(([value]) => value === null)).toBe(true);
  expect(view.controller.getValues()[0]).toBe("kept"); view.controller.destroy();
});

it("updates language without replacing the editors or losing text", () => {
  const view = setup(false, "zh-CN"); const editor = view.input(0, "保留🙂");
  translateDocument();
  setLocale("en"); translateDocument();
  expect(document.querySelector("textarea")).toBe(editor);
  expect(editor.getAttribute("aria-label")).toBe("Input text");
  expect(document.body.textContent).toContain("Confirm text sharing");
  setLocale("zh-CN"); translateDocument();
  expect(editor.getAttribute("aria-label")).toBe("输入文本");
  expect(document.body.textContent).toContain("确认提供文本");
  expect(editor.value).toBe("保留🙂"); view.controller.destroy();
});

it("keeps pasted drafts when switching to files and back without resharing", () => {
  const view = setup(true); view.input(0, "draft"); view.input(1, "$1");
  view.click("Choose files"); expect(view.files).toHaveBeenCalledOnce();
  view.click("Paste text"); expect([...document.querySelectorAll("textarea")].map(input => input.value)).toEqual(["draft", "$1"]);
  expect(view.gateway.prepareResource).not.toHaveBeenCalled(); view.controller.destroy();
});

it("never offers text mode to image or unordered resource tools", () => {
  const view = setup(); view.controller.destroy();
  for (const [types, options] of [[["image/png"], view.options], [["text/plain"], { ...view.options, minResources: 1 }]]) {
    const selection = createResourceInputModes(options, view.files, types);
    expect(document.querySelector("textarea")).toBeNull(); selection.destroy();
  }
});
