import { beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createTextResultExport } from "./text-result-export.js";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", profile = "result.export.text.draft1";
const ref = { resultId: id, contentVersion: "a".repeat(64), byteLength: 72, mimeType: "text/plain" }, scope = { workspaceId: "w", sceneId: "programming", pluginId: "p", capabilityId: "c" };
const receipt = { schemaVersion: 1, profile, grantId: id, destination: "D:\\清单.txt", ...ref };
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
beforeEach(() => { setLocale("en"); document.body.replaceChildren(); });
function fixture() {
  const container = document.createElement("main"); document.body.append(container);
  const api = { choose: vi.fn(async () => ({ schemaVersion: 1, profile, grantId: id, operation: "create_new_file", saved: false, requiresConfirmation: true, expiresInSeconds: 60, preview: { ...receipt } })), cancel: vi.fn(async () => {}), commit: vi.fn(async () => ({ schemaVersion: 1, profile, saved: true, status: "saved", receipt })), verify: vi.fn(async () => ({ schemaVersion: 1, profile, saved: true, status: "verified", receipt })) };
  const c = createTextResultExport({ api, getTarget: () => ({ workspaceId: "w" }), isCurrent: () => true }), saved = vi.fn();
  const click = async text => { [...container.querySelectorAll("button")].find(b => b.textContent === text).click(); await flush(); };
  return { c, api, container, saved, click, open: () => c.open(ref, scope, container, saved) };
}
it("sends only scope plus result handle to native, and requires separate save confirmation", async () => {
  const f = fixture(); await f.open(); expect(f.api.choose).toHaveBeenCalledExactlyOnceWith("w", { scope, resultId: id }); expect(f.api.commit).not.toHaveBeenCalled();
  await f.click("Confirm save file"); expect(f.api.commit).toHaveBeenCalledExactlyOnceWith("w", { scope, resultId: id }, id); expect(f.saved).toHaveBeenCalledOnce(); f.c.destroy();
});
it("rejects unrelated snapshot previews and cancels before writing", async () => {
  const f = fixture(); const wrong = await f.api.choose(); wrong.preview.resultId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; f.api.choose.mockResolvedValueOnce(wrong);
  await f.open(); expect(f.api.cancel).toHaveBeenCalledOnce(); expect(f.api.commit).not.toHaveBeenCalled(); f.c.destroy();
});
it("ambiguous writes only offer full read-only verification and do not replay", async () => {
  const f = fixture(); await f.open(); f.api.commit.mockRejectedValueOnce(Error("lost response")); await f.click("Confirm save file"); await f.click("Check saved file");
  expect(f.api.commit).toHaveBeenCalledOnce(); expect(f.api.verify).toHaveBeenCalledOnce(); expect(f.saved).toHaveBeenCalledOnce(); f.c.destroy();
});
it("native or preview cancellation never writes", async () => {
  const f = fixture(); f.api.choose.mockResolvedValueOnce(null); await f.open(); expect(f.api.commit).not.toHaveBeenCalled();
  await f.open(); await f.click("Cancel save"); expect(f.api.cancel).toHaveBeenCalledOnce(); expect(f.api.commit).not.toHaveBeenCalled(); f.c.destroy();
});
