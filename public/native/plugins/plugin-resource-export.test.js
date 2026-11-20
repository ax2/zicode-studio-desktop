import { beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createResourceExport } from "./plugin-resource-export.js";
import { createResourceSave } from "./plugin-resource-save.js";
const id = "11111111-1111-4111-8111-111111111111", profile = "resource.export.file.draft1";
const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
const resource = { resourceId: id, contentVersion: "a".repeat(64), mimeType: "text/html", byteLength: 10486640 };
const source = { schemaVersion: 1, owner, resourceId: id, contentVersion: resource.contentVersion };
const receipt = { schemaVersion: 1, profile, grantId: id, destination: "D:\\用户文档\\另存结果.html", source, ...resource };
const preview = () => ({ schemaVersion: 1, profile, grantId: id, expiresInSeconds: 60, requiresConfirmation: true, saved: false, operation: "create_new_file", preview: structuredClone(receipt) });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => { setLocale("en"); document.body.replaceChildren(); });
function fixture() {
  const container = document.createElement("main"); document.body.append(container); let target = { workspaceId: "w" };
  const api = { choose: vi.fn(async () => preview()), cancel: vi.fn(async () => {}),
    commit: vi.fn(async () => ({ schemaVersion: 1, profile, status: "saved", saved: true, receipt: structuredClone(receipt) })),
    verify: vi.fn(async () => ({ schemaVersion: 1, profile, status: "verified", saved: true, receipt: structuredClone(receipt) })) };
  const onSaved = vi.fn(), notify = vi.fn();
  const c = createResourceExport({ api, getTarget: () => target, isCurrent: () => true, notify });
  const click = async text => { const b = [...container.querySelectorAll("button")].find(e => e.textContent === text); expect(b).toBeTruthy(); b.click(); await flush(); };
  return { api, c, container, onSaved, notify, click, open: () => c.open(resource, owner, container, onSaved), change: () => { target = { workspaceId: "other" }; } };
}
it("native choice only prepares; shows exact path and complete length, then saves once on separate confirmation", async () => {
  const f = fixture(); await f.open(); expect(f.api.commit).not.toHaveBeenCalled(); expect(f.container.textContent).toContain(receipt.destination);
  expect(f.container.textContent).toContain(resource.byteLength.toLocaleString());
  await f.click("Confirm save file"); expect(f.api.commit).toHaveBeenCalledExactlyOnceWith("w", source, id);
  expect(f.onSaved).toHaveBeenCalledOnce(); expect(f.container.textContent).toContain("Saved copy:");
  await f.click("Close"); expect(f.api.cancel).not.toHaveBeenCalled();
});
it("cancelled native dialog leaves no consent or write, cancelled parent consent revokes only its grant", async () => {
  const f = fixture(); f.api.choose.mockResolvedValueOnce(null); await f.open(); expect(f.container.children).toHaveLength(0); expect(f.api.commit).not.toHaveBeenCalled();
  await f.open(); await f.click("Cancel save"); expect(f.api.cancel).toHaveBeenCalledExactlyOnceWith("w", source, id); expect(f.api.commit).not.toHaveBeenCalled();
});
it("late native picker results after target change or disposal are cancelled without writing", async () => {
  for (const action of [f => f.change(), f => f.c.destroy()]) {
    const f = fixture(); let resolve; f.api.choose.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = f.open(); action(f); resolve(preview()); await pending; expect(f.api.cancel).toHaveBeenCalledOnce(); expect(f.api.commit).not.toHaveBeenCalled(); expect(f.container.children).toHaveLength(0);
  }
});
it("rejects mismatching source/destination receipts and cancels a malformed preview", async () => {
  const f = fixture(); const wrong = preview(); wrong.preview.source.owner.sessionId = "foreign"; f.api.choose.mockResolvedValueOnce(wrong);
  await f.open(); expect(f.api.cancel).toHaveBeenCalledOnce(); expect(f.container.textContent).toContain("could not be confirmed"); expect(f.api.commit).not.toHaveBeenCalled();
  await f.open(); f.api.commit.mockResolvedValueOnce({ schemaVersion: 1, profile, status: "saved", saved: true, receipt: { ...receipt, destination: "other" } });
  await f.click("Confirm save file"); expect(f.onSaved).not.toHaveBeenCalled(); expect(f.container.textContent).toContain("no write was retried");
});
it("ambiguous response offers only explicit read-only verification and never retries write", async () => {
  const f = fixture(); await f.open(); f.api.commit.mockRejectedValueOnce(Error("response lost")); await f.click("Confirm save file");
  expect(f.onSaved).not.toHaveBeenCalled(); await f.click("Check saved file"); expect(f.api.verify).toHaveBeenCalledExactlyOnceWith("w", source, id);
  expect(f.api.commit).toHaveBeenCalledOnce(); expect(f.onSaved).toHaveBeenCalledOnce();
});
it("cannot cancel or duplicate an explicitly committing export, and view disposal never deletes the saved file", async () => {
  const f = fixture(); await f.open(); let resolve; f.api.commit.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await f.click("Confirm save file"); expect(f.container.querySelector("button").disabled).toBe(true); f.c.destroy();
  resolve({ schemaVersion: 1, profile, status: "saved", saved: true, receipt }); await flush(); expect(f.api.cancel).not.toHaveBeenCalled(); expect(f.onSaved).not.toHaveBeenCalled(); expect(f.notify).toHaveBeenCalledOnce();
});
it("existing-file conflicts remain visible and never overwrite or automatically retry", async () => {
  const f = fixture(); f.api.choose.mockRejectedValueOnce("resource_export_conflict"); await f.open();
  expect(f.container.textContent).toContain("Nothing was overwritten"); expect(f.api.commit).not.toHaveBeenCalled();
});
it("other-location choice remains available even when managed project save is unavailable", async () => {
  const f = fixture(); const save = createResourceSave({ gateway: { exports: f.api, prepareResourceSave: async () => { throw Error("permission_denied"); } }, getTarget: () => ({ workspaceId: "w" }), isCurrent: () => true });
  save.open(resource, owner, f.container, f.onSaved); await flush(); await f.click("Choose another location…");
  expect(f.api.choose).toHaveBeenCalledOnce(); expect(f.container.textContent).toContain(receipt.destination); save.destroy();
});
