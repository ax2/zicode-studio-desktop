import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createMultiResourceSelection } from "./plugin-multi-resource-selection.js";

const file = (name, text) => ({ name, size: text.length, type: "text/plain",
  arrayBuffer: vi.fn(async () => new TextEncoder().encode(text).buffer) });
function setup({ projectFiles } = {}) {
  setLocale("en"); vi.stubGlobal("crypto", webcrypto);
  document.body.innerHTML = "<main></main>";
  const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const lengths = new Map(); let issued = 0;
  const gateway = { prepareResource: vi.fn(async request => {
    const id = [first, second][issued++]; lengths.set(id, request.byteLength); return { resourceId: id };
  }), appendResource: vi.fn(async (_access, offset, base64) => ({ uploadedBytes: offset + atob(base64).length })),
  commitResource: vi.fn(async access => ({ ...access, confirmed: true, byteLength: lengths.get(access.resourceId) })),
  revokeResource: vi.fn(async () => ({})), ...(projectFiles ? { projectFiles } : {}) };
  const onResource = vi.fn();
  const controller = createMultiResourceSelection({ container: document.querySelector("main"),
    plugin: { id: "provider", capabilities: [{ id: "archive.create" }] },
    target: { instanceId: "r", sessionId: "s" }, gateway, catalogRevision: "a".repeat(64),
    isCurrent: () => true, onResource, maxResources: 4 });
  const input = document.querySelector('input[type="file"]');
  const button = label => [...document.querySelectorAll("button")].find(item => item.textContent === label);
  const choose = files => { Object.defineProperty(input, "files", { configurable: true, value: files }); input.dispatchEvent(new Event("change")); };
  return { controller, gateway, onResource, input, button, choose };
}
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; setLocale("zh-CN"); });

it("keeps the browser file label after selection and clears it on cancellation", () => {
  const view = setup(); const writes = [];
  Object.defineProperty(view.input, "value", { configurable: true, get: () => "selected files", set: value => writes.push(value) });
  view.choose([file("one.txt", "one"), file("two.txt", "two")]);
  expect(writes).toEqual([]);
  view.button("Cancel file sharing").click();
  expect(writes).toEqual([""]);
  view.controller.destroy();
});

it("keeps two distinct files private until confirmation, then revokes both", async () => {
  const view = setup(); const one = file("one.txt", "one"), two = file("two.txt", "two");
  view.choose([one, two]);
  expect(view.input.multiple).toBe(true);
  expect(one.arrayBuffer).not.toHaveBeenCalled(); expect(two.arrayBuffer).not.toHaveBeenCalled();
  expect(view.gateway.prepareResource).not.toHaveBeenCalled();
  view.button("Confirm file sharing").click();
  await vi.waitFor(() => expect(view.onResource).toHaveBeenCalledOnce());
  const reference = view.onResource.mock.calls[0][0];
  expect(reference.resourceId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  expect(reference.additionalResources).toEqual([{ resourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    contentVersion: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
  expect(view.gateway.prepareResource).toHaveBeenCalledTimes(2);
  view.button("Cancel file sharing").click();
  expect(view.onResource).toHaveBeenLastCalledWith(null);
  expect(view.gateway.revokeResource).toHaveBeenCalledTimes(2);
  view.controller.destroy();
});

it("rejects excess selection and revokes a partial group on upload failure", async () => {
  const view = setup();
  view.choose(Array.from({ length: 5 }, (_, index) => file(`${index}.txt`, "x")));
  expect(view.button("Confirm file sharing").disabled).toBe(true);
  view.choose([file("one.txt", "one"), file("two.txt", "two")]);
  view.gateway.appendResource.mockImplementationOnce(async () => ({ uploadedBytes: 3 }))
    .mockImplementationOnce(async () => { throw new Error("offline"); });
  view.button("Confirm file sharing").click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Choose the files again"));
  expect(view.onResource).not.toHaveBeenCalled();
  expect(view.gateway.revokeResource).toHaveBeenCalledTimes(2);
  expect(document.querySelectorAll(".plugin-resource-file-list li")).toHaveLength(0);
  view.controller.destroy();
});

it("prepares Explorer selection as metadata and shares snapshots only after confirmation", async () => {
  const grants = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const resources = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];
  const version = "c".repeat(64);
  let index = 0;
  const projectFiles = {
    entries: vi.fn(async () => ["中文.zip", "next.txt"]),
    prepare: vi.fn(async (owner, relativePath) => ({ profile: "resource.local-file.draft1",
      grantId: grants[index++], relativePath, byteLength: 3, contentRead: false, confirmed: false, owner })),
    commit: vi.fn(async (owner, grantId) => { const position = grants.indexOf(grantId);
      const access = { owner, resourceId: resources[position], contentVersion: version };
      return { profile: "resource.local-file.draft1", confirmed: true, byteLength: 3,
        resourceId: resources[position], contentVersion: version, access }; }),
    cancel: vi.fn(async () => ({})),
  };
  const view = setup({ projectFiles });
  await vi.waitFor(() => expect(view.button("Use opened selection (2 files)")).toBeTruthy());
  expect(projectFiles.prepare).not.toHaveBeenCalled();
  expect(projectFiles.commit).not.toHaveBeenCalled();
  view.button("Use opened selection (2 files)").click();
  await vi.waitFor(() => expect(view.button("Confirm file sharing").disabled).toBe(false));
  expect(projectFiles.prepare).toHaveBeenCalledTimes(2);
  expect(projectFiles.commit).not.toHaveBeenCalled();
  expect(view.gateway.prepareResource).not.toHaveBeenCalled();
  view.button("Confirm file sharing").click();
  await vi.waitFor(() => expect(view.onResource).toHaveBeenCalledOnce());
  expect(projectFiles.commit).toHaveBeenCalledTimes(2);
  expect(view.onResource.mock.calls[0][0]).toMatchObject({ resourceId: resources[0],
    additionalResources: [{ resourceId: resources[1], contentVersion: version }] });
  view.button("Cancel file sharing").click();
  expect(view.gateway.revokeResource).toHaveBeenCalledTimes(2);
  view.controller.destroy();
});
